import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

export interface EmergencyAdminConfig {
  username: string;
  password: string | undefined;
}

@Injectable()
export class EmergencyAdminBootstrap implements OnModuleInit {
  private readonly logger = new Logger(EmergencyAdminBootstrap.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly cfg: EmergencyAdminConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const existing = await this.prisma.user.findUnique({
        where: { localUsername: this.cfg.username },
      });
      if (existing) {
        this.logger.log(`Emergency admin "${this.cfg.username}" already exists`);
        return;
      }
      if (!this.cfg.password) {
        this.logger.warn(
          `Emergency admin "${this.cfg.username}" not present and INITIAL_ADMIN_LOCAL_PASSWORD is unset. ` +
            `Set the env to bootstrap it.`,
        );
        return;
      }
      const hash = await bcrypt.hash(this.cfg.password, 12);
      await this.prisma.user.create({
        data: {
          localUsername: this.cfg.username,
          localPasswordHash: hash,
          role: 'emergency_admin',
          mustChangePassword: true,
          name: 'Emergency Admin',
        },
      });
      this.logger.log(
        `Created emergency admin "${this.cfg.username}". First login will require password change.`,
      );
    } catch (e) {
      // P2021: table does not exist; P2022: column does not exist —
      // schema not migrated yet (e.g. api started before `prisma migrate deploy`).
      // Bootstrap is best-effort: log + skip so the app does NOT crash-loop;
      // the emergency admin will be created on the next start after migration.
      const code = (e as { code?: string }).code;
      if (code === 'P2021' || code === 'P2022') {
        this.logger.warn(
          'DB schema not ready (migrations pending?) — skipping emergency-admin bootstrap; will retry on next start',
        );
        return;
      }
      throw e; // unknown error — still surface
    }
  }
}
