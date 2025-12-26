import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis;

  constructor() {
    this.client = new Redis({
      host: 'localhost',
      port: 6379,
    });
  }

  async onModuleDestroy() {
    await this.client.quit();
  }

  /**
   * 분산 락 획득
   * @param key 락 키
   * @param ttl 락 만료 시간 (초)
   * @returns 락 획득 성공 여부
   */
  async acquireLock(key: string, ttl: number = 10): Promise<boolean> {
    // SET key value NX EX ttl
    // NX: 키가 없을 때만 설정
    // EX: 만료 시간 설정 (초)
    const result = await this.client.set(key, 'locked', 'EX', ttl, 'NX');
    return result === 'OK';
  }

  /**
   * 분산 락 해제
   */
  async releaseLock(key: string): Promise<void> {
    await this.client.del(key);
  }
}
