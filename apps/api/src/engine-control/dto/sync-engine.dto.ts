import { IsOptional, IsUUID } from 'class-validator';

/**
 * Synchronisation manuelle d'un boîtier. `commandId` désigne la coupure que l'écran a présentée à
 * l'utilisateur : si une autre coupure l'a remplacée entre la question et la confirmation, le serveur
 * refuse (409) plutôt que de synchroniser une commande que personne n'a vue.
 */
export class SyncEngineDto {
  @IsOptional()
  @IsUUID()
  commandId?: string;
}
