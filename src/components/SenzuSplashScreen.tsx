import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { SenzuLogo } from './SenzuLogo';

export interface SenzuSplashScreenProps {
  onFinish?: () => void;
  minDurationMs?: number;
}

export const SenzuSplashScreen: React.FC<SenzuSplashScreenProps> = ({
  onFinish,
  minDurationMs = 1200,
}) => {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    // Only show once per session or quick reload
    const timer = setTimeout(() => {
      setIsVisible(false);
      if (onFinish) {
        setTimeout(onFinish, 400); // Allow fade animation to complete
      }
    }, minDurationMs);

    return () => clearTimeout(timer);
  }, [minDurationMs, onFinish]);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          id="senzu-splash-screen"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.45, ease: 'easeInOut' } }}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#8B5A36] text-white p-6 select-none overflow-hidden"
          onClick={() => setIsVisible(false)} // Tap to skip instantly
        >
          {/* Subtle Ambient Zen Glow inspired by VIP Signature Room Warm Lighting */}
          <div className="absolute w-72 h-72 rounded-full bg-[#D4AF37]/10 blur-3xl pointer-events-none -top-12 -right-12" />
          <div className="absolute w-80 h-80 rounded-full bg-blue-900/15 blur-3xl pointer-events-none -bottom-16 -left-16" />

          {/* Gentle Ensō Zen Ring Accent */}
          <div className="absolute w-64 h-64 rounded-full border border-[#D4AF37]/15 pointer-events-none animate-pulse" />

          {/* Main Brand Logo Lockup - Official Senzu Logo */}
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
            className="relative z-10 flex flex-col items-center text-center max-w-full px-4"
          >
            {/* Official Senzu Light Logo (Vector with PNG Fallback) */}
            <div className="w-[240px] sm:w-[360px] max-w-[400px] flex justify-center items-center">
              <SenzuLogo
                variant="light"
                size="large"
                className="w-full h-auto max-h-[90px] sm:max-h-[120px]"
              />
            </div>

            {/* Separate subtitle text */}
            <p className="mt-4 text-xs sm:text-sm text-[#D4AF37] font-medium tracking-[0.2em] uppercase">
              Home Service Palembang
            </p>

            {/* Subtle Progress Bar */}
            <div className="mt-8 w-36 h-1 rounded-full bg-white/10 overflow-hidden">
              <motion.div
                initial={{ x: '-100%' }}
                animate={{ x: '100%' }}
                transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
                className="w-1/2 h-full bg-gradient-to-r from-transparent via-[#D4AF37] to-transparent"
              />
            </div>
          </motion.div>

          {/* Subtle bottom tagline */}
          <div className="absolute bottom-6 text-center text-slate-400 text-[11px] font-medium tracking-wide">
            Official Palembang Home Wellness
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
