import {
  createAuthStore,
  createPrismaClient,
  type AuthStore,
  type PrismaClient,
} from '@lead-fennec-ai/database';
import {
  Global,
  Inject,
  Injectable,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { API_ENV, type ApiEnv } from '../env.js';

/** Prisma Client for DATABASE_URL. Connects lazily, on the first query. */
export const PRISMA_CLIENT = Symbol('PRISMA_CLIENT');
/** Data access for the authentication tables (platform scope). */
export const AUTH_STORE = Symbol('AUTH_STORE');

@Injectable()
class PrismaShutdown implements OnApplicationShutdown {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async onApplicationShutdown(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: PRISMA_CLIENT,
      inject: [API_ENV],
      useFactory: (env: ApiEnv): PrismaClient =>
        createPrismaClient({
          databaseUrl: env.DATABASE_URL,
          maxConnections: env.DATABASE_POOL_MAX,
        }),
    },
    {
      provide: AUTH_STORE,
      inject: [PRISMA_CLIENT],
      useFactory: (prisma: PrismaClient): AuthStore => createAuthStore(prisma),
    },
    PrismaShutdown,
  ],
  exports: [PRISMA_CLIENT, AUTH_STORE],
})
export class DatabaseModule {}
