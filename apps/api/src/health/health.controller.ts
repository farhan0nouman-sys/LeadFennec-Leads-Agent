import {
  LIVENESS_OK,
  type LivenessReport,
  type ReadinessReport,
} from '@lead-fennec-ai/shared';
import {
  Controller,
  Get,
  Header,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HealthService } from './health.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** The process is up and serving HTTP. Never checks dependencies. */
  @Get('live')
  @Header('Cache-Control', 'no-store')
  live(): LivenessReport {
    return LIVENESS_OK;
  }

  /** PostgreSQL and Redis are reachable. Responds 503 with per-dependency status otherwise. */
  @Get('ready')
  @Header('Cache-Control', 'no-store')
  async ready(): Promise<ReadinessReport> {
    const report = await this.health.readiness();
    if (report.status !== 'ready') {
      throw new ServiceUnavailableException(report);
    }
    return report;
  }
}
