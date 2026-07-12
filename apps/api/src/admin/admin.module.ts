import { Module } from '@nestjs/common';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AuditService } from './audit.service';
import { PaymentsService } from './payments.service';
import { UsersAdminService } from './users-admin.service';

@Module({
  controllers: [AdminController],
  providers: [AdminService, AuditService, PaymentsService, UsersAdminService, PlatformAdminGuard],
  exports: [AuditService, UsersAdminService],
})
export class AdminModule {}
