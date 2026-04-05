'use client';

import { useState, useEffect } from 'react';

const destinations = [
  'Paradise',
  'White Sand Beaches',
  'Adventure',
  'The Moon',
  'Big Cities',
  'The Unknown',
  'Island Life',
  'Sunsets',
  'Hidden Gems',
  'The Mountains',
  'Road Trips',
  'Ancient Ruins',
  'Northern Lights',
  'Street Food',
  'Anywhere',
];

export default function LogoSuffix() {
  const [index, setIndex] = useState(0);
  const [fade, setFade] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setFade(false);
      setTimeout(() => {
        setIndex((i) => (i + 1) % destinations.length);
        setFade(true);
      }, 300);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <>
      <span className="logo-to">.To</span>{' '}
      <span
        className="logo-suffix"
        style={{ opacity: fade ? 1 : 0, transition: 'opacity 0.3s ease' }}
      >
        {destinations[index]}
      </span>
    </>
  );
}
