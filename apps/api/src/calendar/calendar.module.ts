import { Module } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';
import { AppointmentsService } from './appointments.service';
import { AppointmentDetectorService } from './appointment-detector.service';
import { StagesModule } from '../stages/stages.module';

@Module({
  imports: [StagesModule],
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
