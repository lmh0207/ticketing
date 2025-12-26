#!/bin/bash

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

BASE_URL=${BASE_URL:-"http://localhost:3000"}
RESULT_DIR="./k6/results"

# 결과 디렉토리 생성
mkdir -p $RESULT_DIR

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  k6 부하 테스트 스위트${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# DB 초기화 함수
reset_db() {
  echo -e "${YELLOW}DB 초기화 중...${NC}"
  docker exec ticketing-postgres psql -U ticketing -d ticketing -c "
    TRUNCATE reservation, seat, event RESTART IDENTITY CASCADE;
    INSERT INTO event (name, date, \"totalSeats\") VALUES ('BTS 콘서트', '2025-03-01', 1000);
    INSERT INTO seat (\"seatNumber\", \"isReserved\", \"eventId\", version)
    SELECT generate_series(1, 1000), false, 1, 1;
  " > /dev/null 2>&1

  # Redis 락 초기화
  docker exec ticketing-redis redis-cli FLUSHALL > /dev/null 2>&1
  echo -e "${GREEN}DB 초기화 완료${NC}"
}

# 단일 좌석 동시성 테스트
run_single_seat_test() {
  local lock_type=$1
  local vus=$2

  echo -e "\n${YELLOW}[$lock_type] 단일 좌석 동시성 테스트 (VUs: $vus)${NC}"
  reset_db

  k6 run \
    -e LOCK_TYPE=$lock_type \
    -e VUS=$vus \
    -e BASE_URL=$BASE_URL \
    --summary-export=$RESULT_DIR/${lock_type}_single_${vus}.json \
    ./k6/single-seat-test.js 2>&1 | tee $RESULT_DIR/${lock_type}_single_${vus}.log
}

# 부하 테스트 (단계별)
run_load_test() {
  local lock_type=$1

  echo -e "\n${YELLOW}[$lock_type] 단계별 부하 테스트${NC}"
  reset_db

  k6 run \
    -e LOCK_TYPE=$lock_type \
    -e BASE_URL=$BASE_URL \
    --summary-export=$RESULT_DIR/${lock_type}_load.json \
    ./k6/load-test.js 2>&1 | tee $RESULT_DIR/${lock_type}_load.log
}

# 결과 요약 출력
print_summary() {
  echo -e "\n${BLUE}========================================${NC}"
  echo -e "${BLUE}  테스트 결과 요약${NC}"
  echo -e "${BLUE}========================================${NC}"

  echo -e "\n${GREEN}결과 파일 위치: $RESULT_DIR${NC}"
  ls -la $RESULT_DIR
}

# 메인 실행
case "$1" in
  "single")
    # 단일 좌석 테스트만
    for lock in pessimistic optimistic redis; do
      for vus in 10 50 100 500; do
        run_single_seat_test $lock $vus
      done
    done
    ;;
  "load")
    # 부하 테스트만
    for lock in pessimistic optimistic redis; do
      run_load_test $lock
    done
    ;;
  "quick")
    # 빠른 테스트 (100 VUs만)
    for lock in pessimistic optimistic redis; do
      run_single_seat_test $lock 100
    done
    ;;
  *)
    echo "사용법: $0 {single|load|quick}"
    echo ""
    echo "  single - 단일 좌석 동시성 테스트 (10, 50, 100, 500 VUs)"
    echo "  load   - 단계별 부하 테스트"
    echo "  quick  - 빠른 테스트 (100 VUs)"
    exit 1
    ;;
esac

print_summary
