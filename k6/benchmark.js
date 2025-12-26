import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter, Rate } from 'k6/metrics';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';

// 환경 변수
const LOCK_TYPE = __ENV.LOCK_TYPE || 'pessimistic';
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const VUS = parseInt(__ENV.VUS) || 100;
const DURATION = __ENV.DURATION || '30s';

// 커스텀 메트릭
const reservationSuccess = new Counter('reservation_success');
const reservationFail = new Counter('reservation_fail');
const errorRate = new Rate('error_rate');

// 엔드포인트
const endpoints = {
  pessimistic: '/events/1/seats/{seatId}/reserve',
  optimistic: '/events/1/seats/{seatId}/reserve-optimistic',
  redis: '/events/1/seats/{seatId}/reserve-redis',
};

export const options = {
  scenarios: {
    benchmark: {
      executor: 'constant-vus',
      vus: VUS,
      duration: DURATION,
    },
  },
};

let seatId = 1;

export function setup() {
  console.log(`\n🚀 벤치마크 시작`);
  console.log(`   락 타입: ${LOCK_TYPE}`);
  console.log(`   동시 사용자: ${VUS}`);
  console.log(`   지속 시간: ${DURATION}\n`);
  return { lockType: LOCK_TYPE };
}

export default function (data) {
  // 각 요청마다 다른 좌석 (실제 시나리오처럼)
  const currentSeatId = ((__VU * 1000) + __ITER) % 1000 + 1;
  const userId = `user_${__VU}_${Date.now()}`;

  const url = `${BASE_URL}${endpoints[data.lockType].replace('{seatId}', currentSeatId)}`;

  const response = http.post(url, JSON.stringify({ userId }), {
    headers: { 'Content-Type': 'application/json' },
    timeout: '10s',
  });

  const isSuccess = response.status === 200 || response.status === 201;
  const isConflict = response.status === 400 || response.status === 409;
  const isError = !isSuccess && !isConflict;

  if (isSuccess) {
    reservationSuccess.add(1);
  } else {
    reservationFail.add(1);
  }

  errorRate.add(isError ? 1 : 0);

  check(response, {
    'status is valid': (r) => r.status >= 200 && r.status < 500,
  });

  sleep(0.05);
}

export function handleSummary(data) {
  const summary = {
    lockType: LOCK_TYPE,
    vus: VUS,
    duration: DURATION,
    metrics: {
      http_reqs: data.metrics.http_reqs?.values?.count || 0,
      rps: data.metrics.http_reqs?.values?.rate?.toFixed(2) || 0,
      avg_duration: data.metrics.http_req_duration?.values?.avg?.toFixed(2) || 0,
      p95_duration: data.metrics.http_req_duration?.values['p(95)']?.toFixed(2) || 0,
      p99_duration: data.metrics.http_req_duration?.values['p(99)']?.toFixed(2) || 0,
      success_count: data.metrics.reservation_success?.values?.count || 0,
      fail_count: data.metrics.reservation_fail?.values?.count || 0,
    },
  };

  console.log('\n📊 벤치마크 결과:');
  console.log('================');
  console.log(`락 타입: ${summary.lockType}`);
  console.log(`총 요청: ${summary.metrics.http_reqs}`);
  console.log(`RPS: ${summary.metrics.rps}`);
  console.log(`평균 응답시간: ${summary.metrics.avg_duration}ms`);
  console.log(`p95: ${summary.metrics.p95_duration}ms`);
  console.log(`p99: ${summary.metrics.p99_duration}ms`);
  console.log(`성공: ${summary.metrics.success_count}`);
  console.log(`실패(충돌): ${summary.metrics.fail_count}`);

  return {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    [`./k6/results/${LOCK_TYPE}_benchmark_${VUS}vus.json`]: JSON.stringify(summary, null, 2),
  };
}
