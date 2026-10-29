import { Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ANNOUNCEMENTS, activeAnnouncementsFor } from './announcements.catalog';

export interface ActiveAnnouncementDto {
  id: string;
  startsAt: string;
  endsAt: string;
}

@Injectable()
export class AnnouncementsService {
  constructor(private readonly prisma: PrismaService) {}

  async activeFor(user: { role: UserRole; fleetId: string | null }, now = new Date()): Promise<ActiveAnnouncementDto[]> {
    // Le nom de la société n'est lu que s'il peut servir : pas de requête hors période.
    const enCours = ANNOUNCEMENTS.filter((a) => now >= a.startsAt && now < a.endsAt);
    if (enCours.length === 0) return [];

    const fleet = user.fleetId
      ? await this.prisma.fleet.findUnique({ where: { id: user.fleetId }, select: { name: true } })
      : null;

    return activeAnnouncementsFor(enCours, { role: user.role, fleetName: fleet?.name ?? null }, now).map((a) => ({
      id: a.id,
      startsAt: a.startsAt.toISOString(),
      endsAt: a.endsAt.toISOString(),
    }));
  }
}
