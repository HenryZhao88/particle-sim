// helpers/localStorageHelpers.js
// Vanilla port of multitab-particle-bridge src/helpers/localStorageHelpers.ts
// (c) 2025 Kovalenko Dmytro, MIT — see README.

import { COLORS } from '../constants.js';

export const WINDOWS = 'windows';
export const COUNTER = 'counter';

const onErrorFallbackEmptyStore = () => {
  localStorage.setItem(WINDOWS, JSON.stringify({}));
  return {};
};

const getAllWindows = () => {
  const stringWindows = localStorage.getItem(WINDOWS);

  return getAllWindowsFromString(stringWindows);
};

export const getAllWindowsFromString = (localStorageValue) => {
  if (!localStorageValue) {
    return {};
  }

  try {
    const parsedWindows = JSON.parse(localStorageValue);
    return parsedWindows;
  } catch (error) {
    console.error('Error parsing localstorage key', WINDOWS, error);
    return onErrorFallbackEmptyStore();
  }
};

export const addNewWindow = (id) => {
  const shapePositions = {
    x: window.screenLeft,
    y: window.screenTop + (window.outerHeight - window.innerHeight),
    width: window.innerWidth,
    height: window.innerHeight,
  };
  const stringWindows = localStorage.getItem(WINDOWS);
  const stringCounter = localStorage.getItem(COUNTER);
  const numberCounter = Number(stringCounter);
  const newCounter = isNaN(numberCounter) ? 1 : numberCounter + 1;
  localStorage.setItem(COUNTER, JSON.stringify(newCounter));

  const onErrorFallback = () => {
    const createdWindows = { [id]: { ...shapePositions, color: COLORS[0] } };
    localStorage.setItem(WINDOWS, JSON.stringify(createdWindows));
    return createdWindows;
  };

  if (!stringWindows) {
    return onErrorFallback();
  }

  try {
    const parsedWindows = JSON.parse(stringWindows);
    parsedWindows[id] = { ...shapePositions, color: COLORS[Number(stringCounter) % COLORS.length] };
    localStorage.setItem(WINDOWS, JSON.stringify(parsedWindows));
    return parsedWindows;
  } catch (error) {
    console.error('Error parsing localstorage key:', { key: WINDOWS, failedString: stringWindows }, error);
    return onErrorFallback();
  }
};

export const deleteCurrentWindow = (id) => {
  const stringWindows = localStorage.getItem(WINDOWS);

  if (!stringWindows) {
    return onErrorFallbackEmptyStore();
  }

  try {
    const parsedWindows = JSON.parse(stringWindows);
    delete parsedWindows[id];
    localStorage.setItem(WINDOWS, JSON.stringify(parsedWindows));
    return parsedWindows;
  } catch (error) {
    console.error('Error parsing localstorage key:', { key: WINDOWS, failedString: stringWindows }, error);
    return onErrorFallbackEmptyStore();
  }
};

export const updateCurrentWindowPositions = (id, newDimensions) => {
  const stringWindows = localStorage.getItem(WINDOWS);

  if (!stringWindows) {
    return onErrorFallbackEmptyStore();
  }

  try {
    const parsedWindows = JSON.parse(stringWindows);
    parsedWindows[id] = { ...parsedWindows[id], ...newDimensions };
    localStorage.setItem(WINDOWS, JSON.stringify(parsedWindows));
    return parsedWindows;
  } catch (error) {
    console.error('Error parsing localstorage key:', { key: WINDOWS, failedString: stringWindows }, error);
    return onErrorFallbackEmptyStore();
  }
};

export const cleanupDeadWindows = (aliveIds) => {
  const allWindows = getAllWindows();

  for (const id in allWindows) {
    if (!aliveIds.has(id)) {
      delete allWindows[id];
    }
  }

  localStorage.setItem(WINDOWS, JSON.stringify(allWindows));
  return allWindows;
};
