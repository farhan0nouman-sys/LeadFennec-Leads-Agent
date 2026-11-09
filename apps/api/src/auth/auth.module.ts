import { Global, Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { CsrfGuard, OriginGuard, SessionGuard } from './auth-guards.js';
import { AuthTasks } from './auth-tasks.js';
import { AuthController } from './auth.controller.js';
import {
  AUTH_CLOCK,
  AUTH_POLICY,
  DEFAULT_AUTH_POLICY,
  type AuthClock,
  type AuthPolicy,
} from './auth.policy.js';
import { AuthService } from './auth.service.js';
import { PasswordHasher } from './password-hasher.js';

/** Settings and clock, global so the throttler's factory can read them. */
@Global()
@Module({
  providers: [
    { provide: AUTH_POLICY, useValue: DEFAULT_AUTH_POLICY },
    { provide: AUTH_CLOCK, useValue: (() => new Date()) satisfies AuthClock },
  ],
  exports: [AUTH_POLICY, AUTH_CLOCK],
})
export class AuthConfigModule {}

@Module({
  imports: [
    AuthConfigModule,
    // Per-IP limit on the auth routes, in memory (one API instance; O-20 for several).
    ThrottlerModule.forRootAsync({
      imports: [AuthConfigModule],
      inject: [AUTH_POLICY],
      useFactory: (policy: AuthPolicy) => ({
        throttlers: [
          { name: 'default', ttl: 60_000, limit: policy.ipRequestsPerMinute },
        ],
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthTasks,
    OriginGuard,
    SessionGuard,
    CsrfGuard,
    {
      provide: PasswordHasher,
      inject: [AUTH_POLICY],
      useFactory: (policy: AuthPolicy) => new PasswordHasher(policy.argon2),
    },
  ],
  exports: [AuthService, SessionGuard, CsrfGuard, OriginGuard],
})
export class AuthModule {}
