import React, { createContext, useContext } from 'react';
import { APILoadingStatus } from '@vis.gl/react-google-maps';

export interface MapsContextValue {
  hasApiKey: boolean;
  authFailureMessage: string | null;
  loadingStatus: APILoadingStatus;
}

const MapsContext = createContext<MapsContextValue>({
  hasApiKey: false,
  authFailureMessage: null,
  loadingStatus: APILoadingStatus.NOT_LOADED,
});

export const MapsStatusProvider = MapsContext.Provider;

export function useMapsStatus(): MapsContextValue {
  return useContext(MapsContext);
}
