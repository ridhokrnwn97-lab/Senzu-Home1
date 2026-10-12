import type { ServiceItem } from '../types.ts';

export const DEFAULT_SERVICES: ServiceItem[] = [
  {
    id: 'srv-sig-60',
    name: 'Senzu Home Signature 60 Menit',
    duration: 60,
    price: 225000,
    description: 'Kombinasi reflexology titik saraf kaki, relaksasi punggung, leher, dan bahu dengan minyak aromaterapi premium.',
    isPopular: false,
    isActive: true,
  },
  {
    id: 'srv-sig-90',
    name: 'Senzu Home Signature 90 Menit',
    duration: 90,
    price: 325000,
    description: 'Pilihan terfavorit keluarga Palembang. Full body reflexology & massage menyeluruh dari ujung kaki hingga kepala untuk melepas lelah.',
    isPopular: true,
    isActive: true,
  },
  {
    id: 'srv-sig-120',
    name: 'Senzu Home Signature 120 Menit',
    duration: 120,
    price: 425000,
    description: 'Perawatan holistik mendalam: Foot reflexology intensif, akupresur, deep tissue massage & hot stone sensation untuk pemulihan optimal.',
    isPopular: false,
    isActive: true,
  },
];
