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
  }
}
