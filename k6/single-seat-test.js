import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

// 커스텀 메트릭
const successCounter = new Counter('successful_reservations');
const conflictCounter = new Counter('conflict_errors');
const otherErrorCounter = new Counter('other_errors');

// 환경 변수
const LOCK_TYPE = __ENV.LOCK_TYPE || 'pessimistic';
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const VUS = parseInt(__ENV.VUS) || 100;

// 엔드포인트 매핑
const endpoints = {
  pessimistic: '/events/1/seats/1/reserve',
  optimistic: '/events/1/seats/1/reserve-optimistic',
  redis: '/events/1/seats/1/reserve-redis',
};

// 단일 좌석에 동시 요청 (동시성 테스트)
export const options = {
  scenarios: {
    spike: {
      executor: 'shared-iterations',
      vus: VUS,
      iterations: VUS,
      maxDuration: '30s',
    },
  },
  thresholds: {
    successful_reservations: ['count==1'], // 정확히 1개만 성공
  },
};

export function setup() {
  console.log(`\n========================================`);
  console.log(`단일 좌석 동시성 테스트: ${LOCK_TYPE} 락`);
  console.log(`동시 사용자: ${VUS}명`);
  console.log(`========================================\n`);
  return { lockType: LOCK_TYPE };
}

export default function (data) {
  const userId = `user_${__VU}`;
  const url = `${BASE_URL}${endpoints[data.lockType]}`;

  const payload = JSON.stringify({ userId });
  const params = {
    headers: { 'Content-Type': 'application/json' },
    timeout: '30s',
  };

  const response = http.post(url, payload, params);

  check(response, {
    'response received': (r) => r.status > 0,
  });

  if (response.status === 200 || response.status === 201) {
    successCounter.add(1);
    console.log(`✅ VU ${__VU}: 예약 성공!`);
  } else if (response.status === 409 || response.status === 400) {
    conflictCounter.add(1);
  } else {
    otherErrorCounter.add(1);
    console.log(`❌ VU ${__VU}: 에러 - ${response.status} ${response.body}`);
  }
}

export function teardown(data) {
  console.log(`\n========================================`);
  console.log(`테스트 완료: ${data.lockType} 락`);
  console.log(`========================================\n`);
}
