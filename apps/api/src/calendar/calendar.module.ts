import { Module } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';
import { AppointmentsService } from './appointments.service';
import { AppointmentDetectorService } from './appointment-detector.service';

@Module({
  controllers: [CalendarController],
  providers: [
    CalendarService,
    AppointmentsService,
    AppointmentDetectorService,
    AuthGuard,
  ],
  exports: [CalendarService, AppointmentsService, AppointmentDetectorService],
})
export class CalendarModule {}
