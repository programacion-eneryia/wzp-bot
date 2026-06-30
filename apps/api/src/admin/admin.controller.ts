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
import {
  BanDto,
  CreateOrgDto,
  CreateUserDto,
  MembershipDto,
  MoveUserDto,
  PlatformAdminDto,
  ResetPasswordDto,
  RoleDto,
  SuspendOrgDto,
  UpdateOrgDto,
} from './dto/admin.dto';

@Controller('admin')
@UseGuards(PlatformAdminGuard)
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly audit: AuditService,
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
}
