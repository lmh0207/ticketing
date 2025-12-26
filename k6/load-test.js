import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

// 커스텀 메트릭
const successCounter = new Counter('successful_reservations');
const failCounter = new Counter('failed_reservations');
const reservationDuration = new Trend('reservation_duration');

// 환경 변수로 락 타입 선택
const LOCK_TYPE = __ENV.LOCK_TYPE || 'pessimistic';
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

// 엔드포인트 매핑
const endpoints = {
  pessimistic: '/events/1/seats/{seatId}/reserve',
  optimistic: '/events/1/seats/{seatId}/reserve-optimistic',
  redis: '/events/1/seats/{seatId}/reserve-redis',
};

// 단계별 부하 설정
export const options = {
  scenarios: {
    load_test: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 10 }, // 10명으로 증가
        { duration: '20s', target: 10 }, // 10명 유지
        { duration: '10s', target: 50 }, // 50명으로 증가
        { duration: '20s', target: 50 }, // 50명 유지
        { duration: '10s', target: 100 }, // 100명으로 증가
        { duration: '20s', target: 100 }, // 100명 유지
        { duration: '10s', target: 500 }, // 500명으로 증가
        { duration: '20s', target: 500 }, // 500명 유지
        { duration: '10s', target: 0 }, // 종료
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<5000'], // p95 < 5초
    http_req_failed: ['rate<0.99'], // 에러율 99% 미만 (락 실패는 정상)
  },
};

// 좌석 ID를 순환하며 사용 (동시성 테스트를 위해)
let seatCounter = 1;
const MAX_SEATS = 1000;

export function setup() {
  console.log(`\n========================================`);
  console.log(`부하 테스트 시작: ${LOCK_TYPE} 락`);
  console.log(`========================================\n`);
  return { lockType: LOCK_TYPE };
}

export default function (data) {
  // 좌석 ID 할당 (VU별로 다른 좌석 시도)
  const seatId = (__VU % MAX_SEATS) + 1;
  const userId = `user_${__VU}_${__ITER}`;

  const url = `${BASE_URL}${endpoints[data.lockType].replace('{seatId}', seatId)}`;

  const payload = JSON.stringify({ userId });
  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
    timeout: '10s',
  };

  const startTime = Date.now();
  const response = http.post(url, payload, params);
  const duration = Date.now() - startTime;

  reservationDuration.add(duration);

  const success = check(response, {
    'status is 2xx or 4xx': (r) => r.status >= 200 && r.status < 500,
    'response has body': (r) => r.body && r.body.length > 0,
  });

  if (response.status === 201 || response.status === 200) {
    successCounter.add(1);
  } else {
    failCounter.add(1);
  }

  // 요청 간 약간의 딜레이
  sleep(0.1);
}

export function teardown(data) {
  console.log(`\n========================================`);
  console.log(`부하 테스트 완료: ${data.lockType} 락`);
  console.log(`========================================\n`);
}
