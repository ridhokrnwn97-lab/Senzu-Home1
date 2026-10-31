import type { ServiceItem } from '../types';

// Manager catalogs keep inactive entries for editing and booking history.
// New Home Service reservations may only use explicitly active services.
export function getCustomerServices(services: readonly ServiceItem[] | null | undefined): ServiceItem[] {
  return (services || []).filter(service => service.isActive === true && service.serviceType !== 'OUTLET');
}
