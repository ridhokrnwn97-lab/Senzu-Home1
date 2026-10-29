/**
 * Centralized service validation utilities.
 *
 * Discontinued services are those that have been removed from the active catalog
 * but may still appear in Firestore cache or historical bookings.
 * This module provides safe checks to reject them for new bookings
 * while preserving data integrity for existing records.
 */

/**
 * Check if a service corresponds to a discontinued Signature service.
 *
 * Discontinued services are those that have been removed from the active catalog
 * along with their Accurate integration. New bookings using these services should be rejected.
 *
 * This function checks both the service ID AND the service properties (name, duration)
 * to handle cases where Firestore document IDs may differ from the expected patterns.
 *
 * @param service - The service object to check (may be partial, only id/name/duration needed)
 * @returns true if the service is a discontinued Signature service
 */
export function isDiscontinuedService(
  service: { id?: string; name?: string; duration?: number } | null | undefined,
): boolean {
  if (!service) return false;

  const id = service.id?.trim().toUpperCase();
  const name = service.name?.trim().toLowerCase() ?? '';
  const duration = Number(service.duration);

  if (
    id === 'SH-SIG-030' ||
    id === 'SH-SIG-060' ||
    id === 'SRV-SIG-60'
  ) {
    return true;
  }

  const isSignature =
    name.includes('signature') &&
    (name.includes('senzu') || name.includes('treatment'));

  return isSignature && (duration === 30 || duration === 60);
}

/**
 * Filter out discontinued service items from a service list.
 *
 * Preserves the original order of valid services while removing any
 * that match discontinued ID patterns or name/duration patterns.
 * Used for cache cleanup and Firestore fallback scenarios.
 *
 * @param services - Raw service list from Firestore or cache
 * @returns Filtered service list without discontinued items
 */
export function filterDiscontinuedServices(services: any[]): any[] {
  return services.filter((s) => !isDiscontinuedService({
    id: s.id,
    name: s.name,
    duration: s.duration,
  }));
}

/**
 * Get only the safe, active service IDs from a list.
 *
 * Useful for skill matrix checks and service area validation
 * where discontinued IDs must never be passed downstream.
 *
 * @param services - Service item array
 * @returns Array of service IDs that are NOT discontinued
 */
export function getSafeServiceIds(services: any[]): string[] {
  return services
    .filter((s) => !isDiscontinuedService({
      id: s.id,
      name: s.name,
      duration: s.duration,
    }))
    .map((s) => s.id || '');
}
