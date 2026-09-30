import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthContext } from '../auth/auth.types';
import { MeService } from './me.service';

class DashboardPrefsDto {
  @IsArray() @ArrayMaxSize(40) @IsString({ each: true }) widgets!: string[];
}

class ProfileDto {
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(120) full_name?: string | null;
}

@Controller('me')
@UseGuards(AuthGuard)
export class MeController {
  constructor(private readonly me: MeService) {}

  @Get('profile')
  profile(@CurrentUser() user: AuthContext) {
    return this.me.getProfile(user.userId);
  }

  @Put('profile')
  updateProfile(@CurrentUser() user: AuthContext, @Body() dto: ProfileDto) {
    return this.me.updateProfile(user.userId, dto);
  }

  @Get('dashboard')
  async dashboard(@CurrentUser() user: AuthContext) {
    // Nest serializa `null` como body vacío; devolvemos siempre un objeto JSON.
    return (await this.me.getDashboardPrefs(user.userId)) ?? { widgets: [] };
  }

  @Put('dashboard')
  setDashboard(@CurrentUser() user: AuthContext, @Body() dto: DashboardPrefsDto) {
    return this.me.setDashboardPrefs(user.userId, dto);
  }

  @Get('onboarding')
  onboarding(@CurrentUser() user: AuthContext) {
    return this.me.onboardingStatus(user.organizationId);
  }

  @Post('onboarding/complete')
  completeOnboarding(@CurrentUser() user: AuthContext) {
    return this.me.completeOnboarding(user.organizationId);
  }

  @Post('onboarding/reset')
  resetOnboarding(@CurrentUser() user: AuthContext) {
    return this.me.resetOnboarding(user.organizationId);
  }
}
