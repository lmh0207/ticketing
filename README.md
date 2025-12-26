# 선착순 티켓 예매 시스템

동시성 처리 학습을 위한 티켓 예매 시스템입니다.

## 기술 스택

- NestJS + TypeScript
- PostgreSQL (TypeORM)
- Redis (ioredis)
- Docker Compose

## 실행 방법

```bash
# 인프라 실행 (PostgreSQL, Redis)
docker-compose up -d

# 의존성 설치
npm install

# 개발 서버 실행
npm run start:dev
```

## API 엔드포인트

| 방식 | 엔드포인트 |
|------|-----------|
| 비관적 락 | `POST /events/:eventId/seats/:seatId/reserve` |
| 낙관적 락 | `POST /events/:eventId/seats/:seatId/reserve-optimistic` |
| Redis 분산 락 | `POST /events/:eventId/seats/:seatId/reserve-redis` |

## 동시성 제어 방식 비교

### 1. 비관적 락 (Pessimistic Lock)

```sql
SELECT * FROM seat WHERE id = 1 FOR UPDATE
```

**동작 방식**
- DB 레벨에서 `SELECT ... FOR UPDATE`로 행 잠금
- 락을 획득한 트랜잭션이 완료될 때까지 다른 트랜잭션은 대기

**장점**
- 데이터 정합성 보장이 확실함
- 충돌이 많은 환경에서 안정적

**단점**
- 대기 시간이 길어짐 (순차 처리)
- 데드락 가능성 존재
- DB 커넥션을 오래 점유

**적합한 상황**
- 충돌이 자주 발생하는 경우
- 데이터 정합성이 최우선인 경우

---

### 2. 낙관적 락 (Optimistic Lock)

```typescript
@VersionColumn()
version: number;
```

**동작 방식**
- 버전 컬럼을 사용하여 충돌 감지
- 저장 시점에 버전이 변경되었으면 예외 발생

**장점**
- 락 대기 없이 병렬 처리 가능
- 읽기 작업이 많은 경우 성능 우수

**단점**
- 충돌 시 재시도 필요 (retry storm 위험)
- 모든 요청이 DB까지 도달함

**적합한 상황**
- 충돌이 드문 경우 (일반 CRUD)
- 읽기 비율이 높은 경우

---

### 3. Redis 분산 락 (Distributed Lock)

```typescript
SET lock:seat:1:1 "locked" NX EX 10
```

**동작 방식**
- Redis의 원자적 연산으로 락 획득
- 락 획득 실패 시 즉시 거절 (DB 접근 안 함)

**장점**
- DB 부하 감소 (락 실패 시 DB 접근 X)
- 분산 환경에서 동작 (여러 서버 간 락 공유)
- 빠른 실패 응답

**단점**
- Redis 장애 시 서비스 영향
- 락 해제 전 프로세스 종료 시 TTL까지 대기 필요

**적합한 상황**
- 순간적으로 트래픽이 폭발하는 경우 (티켓팅, 선착순)
- 분산 서버 환경
- DB 보호가 필요한 경우

---

## 성능 비교 (100개 동시 요청 기준)

| 방식 | 처리 시간 | 성공 | 실패 | DB 접근 |
|------|----------|------|------|---------|
| 비관적 락 | ~10초 (순차) | 1개 | 99개 (대기 후 실패) | 100회 |
| 낙관적 락 | ~0.3초 | 1개 | 99개 (버전 충돌) | 100회 |
| Redis 락 | ~0.1초 | 1개 | 99개 (즉시 거절) | 1회 |

---

## 요약

```
티켓팅 같은 고경쟁 상황 → Redis 분산 락 (DB 보호)
일반 CRUD, 충돌 드묾 → 낙관적 락 (간단)
데이터 정합성 최우선 → 비관적 락 (안전)
```
