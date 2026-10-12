import React, { useState } from 'react';

export interface SenzuLogoProps {
  variant?: 'light' | 'dark' | 'compact' | 'primary' | 'monogram' | 'stacked' | 'wordmark' | 'app_icon';
  theme?: 'dark' | 'light' | 'gold';
  size?: 'small' | 'medium' | 'large' | 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  alt?: string;
  // Legacy props gracefully ignored so callers do not break
  subtitle?: string;
  showJapaneseText?: boolean;
  showHomeBadge?: boolean;
}

/**
 * Official Senzu Brand Logo Component
 * Exclusively loads authentic official image assets from /assets/brand/.
 * Strictly avoids generated SVG paths, typography fonts, or artificial badges.
 */
export const SenzuLogo: React.FC<SenzuLogoProps> = ({
  variant = 'light',
  theme = 'dark',
  size = 'medium',
  className = '',
  alt = 'Senzu Reflexology & Family Massage',
}) => {
  const [imgError, setImgError] = useState(false);

  // Determine official brand image asset based on variant & theme
  let svgSrc = '/assets/brand/senzu-logo-light.svg';
  let pngSrc = '/assets/brand/senzu-logo-light.png';

  if (variant === 'compact') {
    svgSrc = '/assets/brand/senzu-logo-compact.svg';
    pngSrc = '/assets/brand/senzu-logo-compact.png';
  } else if (variant === 'dark' || (variant !== 'light' && theme === 'light')) {
    svgSrc = '/assets/brand/senzu-logo-dark.svg';
    pngSrc = '/assets/brand/senzu-logo-dark.png';
  } else if (variant === 'app_icon' || variant === 'monogram') {
    svgSrc = '/assets/brand/senzu-app-icon.svg';
    pngSrc = '/assets/brand/senzu-app-icon.png';
  } else {
    // Default: light (pure white on navy/dark backgrounds)
    svgSrc = '/assets/brand/senzu-logo-light.svg';
    pngSrc = '/assets/brand/senzu-logo-light.png';
  }

  // Sizing presets ensuring responsive bounds without stretching or cropping
  let sizeClasses = 'h-10 sm:h-14 w-auto max-w-[190px] sm:max-w-[250px]';
  if (variant === 'app_icon' || variant === 'monogram') {
    if (size === 'xs' || size === 'sm' || size === 'small') {
      sizeClasses = 'w-8 h-8 sm:w-9 sm:h-9';
    } else if (size === 'lg' || size === 'xl' || size === 'large') {
      sizeClasses = 'w-14 h-14 sm:w-16 sm:h-16';
    } else {
      sizeClasses = 'w-10 h-10 sm:w-12 sm:h-12';
    }
  } else {
    if (size === 'xs' || size === 'sm' || size === 'small') {
      sizeClasses = 'h-8 sm:h-10 w-auto max-w-[160px] sm:max-w-[200px]';
    } else if (size === 'lg' || size === 'xl' || size === 'large') {
      sizeClasses = 'h-14 sm:h-20 w-auto max-w-[280px] sm:max-w-[380px]';
    } else {
      sizeClasses = 'h-10 sm:h-14 w-auto max-w-[190px] sm:max-w-[250px]';
    }
  }

  return (
    <img
      src={imgError ? pngSrc : svgSrc}
      alt={alt}
      className={`object-contain select-none ${sizeClasses} ${className}`}
      onError={() => {
        if (!imgError) setImgError(true);
      }}
      loading="eager"
      decoding="async"
    />
  );
};
