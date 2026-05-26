// eslint-disable-next-line import/no-unresolved
import { Module } from '@nestjs/common';

// eslint-disable-next-line import/no-unresolved
import { AuthModule } from '../auth/auth.module.js';

// eslint-disable-next-line import/no-unresolved
import { UsersController } from './users.controller.js';
// eslint-disable-next-line import/no-unresolved
import { UsersService } from './users.service.js';

@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
