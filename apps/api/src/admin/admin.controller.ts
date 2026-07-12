import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthContext } from '../auth/auth.types';
import { AdminService } from './admin.service';
import { AuditService } from './audit.service';
import { PaymentsService } from './payments.service';
import { PlatformSettingsService } from '../platform/platform-settings.service';
import { ErrorLogService } from '../platform/error-log.service';
import {
  BanDto,
  CreateOrgDto,
  CreateUserDto,
  MembershipDto,
  MoveUserDto,
  PlatformAdminDto,
  RecordPaymentDto,
  ResetPasswordDto,
  RoleDto,
  SuspendOrgDto,
  UpdateBillingDto,
  UpdateOrgDto,
  UpdatePlatformSettingsDto,
} from './dto/admin.dto';

@Controller('admin')
@UseGuards(PlatformAdminGuard)
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly audit: AuditService,
    private readonly payments: PaymentsService,
    private readonly settings: PlatformSettingsService,
    private readonly errors: ErrorLogService,
  ) {}

  // --- Organizaciones ---
  @Get('organizations')
  listOrgs() {
    return this.admin.listOrganizations();
  }

  @Post('organizations')
  createOrg(@CurrentUser() user: AuthContext, @Body() dto: CreateOrgDto) {
    return this.admin.createOrganization(user, dto);
  }

  @Patch('organizations/:id')
  updateOrg(@CurrentUser() user: AuthContext, @Param('id') id: string, @Body() dto: UpdateOrgDto) {
    return this.admin.updateOrganization(user, id, dto);
  }

  @Post('organizations/:id/suspend')
  suspendOrg(@CurrentUser() user: AuthContext, @Param('id') id: string, @Body() dto: SuspendOrgDto) {
    return this.admin.suspendOrganization(user, id, dto.suspended);
  }

  @Delete('organizations/:id')
  deleteOrg(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.admin.deleteOrganization(user, id);
  }

  @Get('organizations/:id/metrics')
  orgMetrics(@Param('id') id: string) {
    return this.admin.orgMetrics(id);
  }

  // --- Costes (consumo de IA + cuentas Unipile) ---
  @Get('costs')
  costs() {
    return this.admin.costs();
  }

  // --- Usuarios ---
  @Get('users')
  listUsers(@Query('search') search?: string, @Query('organizationId') organizationId?: string) {
    return this.admin.listUsers({ search, organizationId });
  }

  @Post('users')
  createUser(@CurrentUser() user: AuthContext, @Body() dto: CreateUserDto) {
    return this.admin.createUser(user, dto);
  }

  @Post('users/:id/role')
  setRole(@CurrentUser() user: AuthContext, @Param('id') id: string, @Body() dto: RoleDto) {
    return this.admin.updateRole(user, id, dto.organizationId, dto.role);
  }

  @Post('users/:id/membership')
  addMembership(@CurrentUser() user: AuthContext, @Param('id') id: string, @Body() dto: MembershipDto) {
    return this.admin.addMembership(user, id, dto.organizationId, dto.role ?? 'closer');
  }

  @Delete('users/:id/membership/:orgId')
  removeMembership(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Param('orgId') orgId: string,
  ) {
    return this.admin.removeMembership(user, id, orgId);
  }

  @Post('users/:id/move')
  moveUser(@CurrentUser() user: AuthContext, @Param('id') id: string, @Body() dto: MoveUserDto) {
    return this.admin.moveUser(
      user,
      id,
      dto.fromOrganizationId ?? '',
      dto.toOrganizationId,
      dto.role ?? 'closer',
    );
  }

  @Post('users/:id/reset-password')
  resetPassword(@CurrentUser() user: AuthContext, @Param('id') id: string, @Body() dto: ResetPasswordDto) {
    return this.admin.resetPassword(user, id, dto.password);
  }

  @Post('users/:id/ban')
  ban(@CurrentUser() user: AuthContext, @Param('id') id: string, @Body() dto: BanDto) {
    return this.admin.setBanned(user, id, dto.banned);
  }

  @Post('users/:id/platform-admin')
  setPlatformAdmin(@CurrentUser() user: AuthContext, @Param('id') id: string, @Body() dto: PlatformAdminDto) {
    return this.admin.setPlatformAdmin(user, id, dto.value);
  }

  @Delete('users/:id')
  deleteUser(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.admin.deleteUser(user, id);
  }

  @Post('users/:id/impersonate')
  impersonate(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.admin.impersonate(user, id);
  }

  // --- Auditoría ---
  @Get('audit')
  audit_(@Query('action') action?: string, @Query('organizationId') organizationId?: string) {
    return this.audit.list({ action, organizationId });
  }

  // --- Entrenamiento base del setter (ajustes globales) ---
  @Get('settings')
  getSettings() {
    return this.settings.get();
  }

  @Patch('settings')
  updateSettings(@CurrentUser() user: AuthContext, @Body() dto: UpdatePlatformSettingsDto) {
    return this.settings.update(user.userId, dto);
  }

  // --- Logs de errores del sistema ---
  @Get('errors')
  listErrors(@Query('organizationId') organizationId?: string) {
    return this.errors.list({ organizationId });
  }

  @Delete('errors')
  clearErrors() {
    return this.errors.clear();
  }

  // --- Facturación / pagos ---
  @Get('billing')
  billing() {
    return this.payments.billing();
  }

  @Get('payments')
  listPayments(@Query('organizationId') organizationId?: string) {
    return this.payments.listPayments(organizationId);
  }

  @Patch('organizations/:id/billing')
  updateBilling(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdateBillingDto,
  ) {
    return this.payments.updateBilling(user, id, dto);
  }

  @Post('organizations/:id/payments')
  recordPayment(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: RecordPaymentDto,
  ) {
    return this.payments.recordPayment(user, id, dto);
  }

  @Delete('payments/:id')
  deletePayment(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.payments.deletePayment(user, id);
  }
}
