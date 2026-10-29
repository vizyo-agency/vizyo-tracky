import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AnnouncementsService } from './announcements.service';

@Controller('announcements')
export class AnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  /** Annonces ouvertes à l'utilisateur courant (tout rôle authentifié ; liste vide le plus souvent). */
  @Get('active')
  @UseGuards(JwtAuthGuard)
  active(@Req() req: AuthenticatedRequest) {
    return this.announcements.activeFor({ role: req.user.role, fleetId: req.user.fleetId });
  }
}
