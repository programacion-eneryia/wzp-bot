import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthContext } from '../auth/auth.types';
import { CalendarService } from './calendar.service';
import { AppointmentsService } from './appointments.service';
import { ConnectCalendarDto, UpdateCalendarDto } from './dto/calendar.dto';

@Controller('calendar')
@UseGuards(AuthGuard)
export class CalendarController {
  constructor(
    private readonly calendar: CalendarService,
    private readonly appointments: AppointmentsService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthContext) {
    return this.calendar.list(user.organizationId);
  }

  @Post('connect')
  connect(@CurrentUser() user: AuthContext, @Body() dto: ConnectCalendarDto) {
    return this.calendar.connect(user, dto.provider);
  }

  @Put(':id')
  update(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdateCalendarDto,
  ) {
    return this.calendar.update(user, id, dto);
  }

  @Delete(':id')
  disconnect(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.calendar.disconnect(user, id);
  }

  @Get('appointments')
  appointmentsList(@CurrentUser() user: AuthContext) {
    return this.appointments.list(user.organizationId);
  }
}
