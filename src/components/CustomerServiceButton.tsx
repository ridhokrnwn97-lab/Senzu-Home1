import React from 'react';
import { Phone, ChevronRight } from 'lucide-react';
import {
  useCustomerServiceWhatsApp,
  DEFAULT_CS_MESSAGE,
} from '../lib/supportWhatsApp';

interface CustomerServiceButtonProps {
  id?: string;
  message?: string;
  className?: string;
  label?: string;
  showIcon?: boolean;
  showChevron?: boolean;
  variant?: 'primary' | 'outline' | 'minimal' | 'custom';
}

export const CustomerServiceButton: React.FC<CustomerServiceButtonProps> = ({
  id = 'btn-contact-cs',
  message = DEFAULT_CS_MESSAGE,
  className,
  label = 'Hubungi CS',
  showIcon = false,
  showChevron = true,
  variant = 'primary',
}) => {
  const { isAvailable, openWhatsApp, getWhatsAppUrl, unavailableNotice } =
    useCustomerServiceWhatsApp();

  const url = getWhatsAppUrl(message);

  const handleClick = (e: React.MouseEvent) => {
    if (!isAvailable || !url) {
      e.preventDefault();
      alert(unavailableNotice);
    }
  };

  const baseStyles = {
    primary:
      'px-3.5 py-2.5 min-h-[44px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 shrink-0 shadow-xs transition active:scale-95 cursor-pointer',
    outline:
      'px-3.5 py-2 min-h-[40px] rounded-xl border border-emerald-600 text-emerald-700 hover:bg-emerald-50 text-xs font-bold flex items-center gap-1.5 transition active:scale-95 cursor-pointer',
    minimal:
      'text-emerald-700 hover:text-emerald-800 font-semibold text-xs inline-flex items-center gap-1 cursor-pointer',
    custom: '',
  };

  const chosenStyle = className || baseStyles[variant];

  if (!isAvailable) {
    return (
      <button
        id={id}
        type="button"
        onClick={() => alert(unavailableNotice)}
        className={chosenStyle}
        title={unavailableNotice}
      >
        {showIcon && <Phone className="w-3.5 h-3.5" />}
        <span>{label}</span>
        {showChevron && <ChevronRight className="w-3.5 h-3.5" />}
      </button>
    );
  }

  return (
    <a
      id={id}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={handleClick}
      className={chosenStyle}
    >
      {showIcon && <Phone className="w-3.5 h-3.5" />}
      <span>{label}</span>
      {showChevron && <ChevronRight className="w-3.5 h-3.5" />}
    </a>
  );
};
