import React, { useState } from 'react';
import { X, Copy, Check, Smartphone, FileCode2 } from 'lucide-react';

interface AndroidSourceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const APP_JSON_CODE = `{
  "expo": {
    "name": "SafeRoute Android",
    "slug": "saferoute-android",
    "version": "1.0.0",
    "orientation": "portrait",
    "userInterfaceStyle": "dark",
    "androidStatusBar": {
      "barStyle": "light-content",
      "backgroundColor": "#00000000",
      "translucent": true
    },
    "android": {
      "package": "com.saferoute.android",
      "minSdkVersion": 21,
      "permissions": [
        "android.permission.ACCESS_COARSE_LOCATION",
        "android.permission.ACCESS_FINE_LOCATION"
      ],
      "config": {
        "googleMaps": {
          "apiKey": "process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY"
        }
      }
    },
    "plugins": [
      [
        "expo-location",
        {
          "locationAlwaysAndWhenInUsePermission": "Allow SafeRoute Android to access your location for turn-by-turn safe routing and real-time area safety scoring."
        }
      ]
    ]
  }
}`;

const REACT_NATIVE_SCREEN_CODE = `import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  BackHandler,
  StatusBar,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { analyzeLocationSafety } from './services/geminiSafetyService';

export default function SafeRouteAndroidApp() {
  const mapRef = useRef<MapView | null>(null);
  const bottomSheetRef = useRef<BottomSheet | null>(null);
  const snapPoints = useMemo(() => ['22%', '78%'], []);

  const [sheetIndex, setSheetIndex] = useState(0);
  const [userCoords, setUserCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [searchQuery, setSearchQuery] = useState('Union Square, San Francisco');
  const [destination, setDestination] = useState({
    name: 'Union Square, San Francisco',
    latitude: 37.7879,
    longitude: -122.4075,
  });
  const [routeActive, setRouteActive] = useState(false);
  const [routeCoordinates, setRouteCoordinates] = useState<{ latitude: number; longitude: number }[]>([]);
  const [safetyReport, setSafetyReport] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  // Android Hardware BackHandler Integration
  useEffect(() => {
    const onBackPress = () => {
      if (sheetIndex > 0) {
        bottomSheetRef.current?.snapToIndex(0);
        return true;
      }
      if (routeActive) {
        setRouteActive(false);
        setRouteCoordinates([]);
        return true;
      }
      return false;
    };

    const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => subscription.remove();
  }, [sheetIndex, routeActive]);

  // Request Android Fine & Coarse Geolocation Permissions
  const requestAndroidLocation = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setPermissionDenied(true);
        return;
      }
      setPermissionDenied(false);
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setUserCoords({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      });
    } catch {
      setPermissionDenied(true);
    }
  }, []);

  useEffect(() => {
    requestAndroidLocation();
  }, [requestAndroidLocation]);

  const runSafetyEvaluation = useCallback(async (targetName: string) => {
    setLoading(true);
    try {
      const result = await analyzeLocationSafety(targetName);
      setSafetyReport(result);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    runSafetyEvaluation(destination.name);
  }, [destination.name, runSafetyEvaluation]);

  const badgeColor =
    (safetyReport?.safety_rating ?? 5.0) >= 4.0
      ? '#10b981'
      : (safetyReport?.safety_rating ?? 5.0) >= 3.0
        ? '#f59e0b'
        : '#f43f5e';

  return (
    <SafeAreaProvider>
      <View className="flex-1 bg-slate-950">
        <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />

        <MapView
          ref={mapRef}
          provider={PROVIDER_GOOGLE}
          className="w-full h-full"
          showsUserLocation={!permissionDenied}
          initialRegion={{
            latitude: destination.latitude,
            longitude: destination.longitude,
            latitudeDelta: 0.03,
            longitudeDelta: 0.03,
          }}
        >
          {routeActive && routeCoordinates.length > 0 && (
            <Polyline
              coordinates={routeCoordinates}
              strokeWidth={5}
              strokeColor={badgeColor}
            />
          )}

          <Marker
            coordinate={{ latitude: destination.latitude, longitude: destination.longitude }}
            onPress={() => bottomSheetRef.current?.expand()}
          >
            <View className="px-3 py-1.5 rounded-xl bg-slate-900 border border-emerald-400">
              <Text className="text-xs font-bold text-white">
                {(safetyReport?.safety_rating ?? 5.0).toFixed(1)} / 5.0 · {safetyReport?.risk_level ?? 'Safe'}
              </Text>
            </View>
          </Marker>
        </MapView>

        {/* Top Floating Material Search Overlay */}
        <SafeAreaView className="absolute top-2 left-3 right-3">
          <View className="bg-slate-900/95 rounded-2xl p-2.5 border border-slate-800 flex-row items-center gap-2">
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              onSubmitEditing={() => setDestination((prev) => ({ ...prev, name: searchQuery }))}
              placeholder="Search destination..."
              placeholderTextColor="#64748b"
              className="flex-1 text-slate-100 text-sm px-3 py-2 bg-slate-950 rounded-xl"
            />
            <TouchableOpacity
              onPress={requestAndroidLocation}
              className="px-3 py-2.5 rounded-xl bg-slate-800"
            >
              <Text className="text-xs text-sky-300 font-semibold">GPS</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setRouteActive((prev) => !prev)}
              className="px-3 py-2.5 rounded-xl bg-emerald-500"
            >
              <Text className="text-xs text-slate-950 font-bold">Route</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>

        {/* Draggable Crime Intelligence Bottom Sheet */}
        <BottomSheet
          ref={bottomSheetRef}
          index={0}
          snapPoints={snapPoints}
          onChange={setSheetIndex}
          backgroundStyle={{ backgroundColor: '#0f172a' }}
          handleIndicatorStyle={{ backgroundColor: '#475569' }}
        >
          <BottomSheetScrollView className="px-4 pt-2">
            {loading ? (
              <ActivityIndicator size="large" color="#10b981" />
            ) : (
              <View>
                <Text className="text-lg font-bold text-white">{safetyReport?.location}</Text>
                <Text className="text-sm text-slate-300 mt-1">{safetyReport?.summary}</Text>
              </View>
            )}
          </BottomSheetScrollView>
        </BottomSheet>
      </View>
    </SafeAreaProvider>
  );
}`;

export const AndroidSourceModal: React.FC<AndroidSourceModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [selectedFile, setSelectedFile] = useState<'app.json' | 'SafeRouteAndroid.tsx'>(
    'SafeRouteAndroid.tsx'
  );
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const activeCode =
    selectedFile === 'app.json' ? APP_JSON_CODE : REACT_NATIVE_SCREEN_CODE;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(activeCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-white/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-3xl max-h-[85vh] rounded-2xl bg-white border border-slate-200 shadow-2xl flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <Smartphone className="w-4 h-4 text-emerald-600" />
            <h2 className="text-sm font-semibold text-slate-900">
              Expo React Native Android Source & Manifest
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="min-w-[36px] min-h-[36px] rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 flex items-center justify-center transition-colors"
            aria-label="Close source modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* File Tabs + Copy Action */}
        <div className="px-5 py-2.5 bg-slate-50/80 border-b border-slate-200 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setSelectedFile('SafeRouteAndroid.tsx')}
              className={`min-h-[34px] px-3 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors ${
                selectedFile === 'SafeRouteAndroid.tsx'
                  ? 'bg-slate-100 text-emerald-700'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <FileCode2 className="w-3.5 h-3.5" />
              <span>SafeRouteAndroid.tsx</span>
            </button>
            <button
              type="button"
              onClick={() => setSelectedFile('app.json')}
              className={`min-h-[34px] px-3 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors ${
                selectedFile === 'app.json'
                  ? 'bg-slate-100 text-emerald-700'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <FileCode2 className="w-3.5 h-3.5" />
              <span>app.json (Android API 21+)</span>
            </button>
          </div>

          <button
            type="button"
            onClick={handleCopy}
            className="min-h-[34px] px-3 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-medium text-slate-800 flex items-center gap-1.5 transition-colors"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copy Code</span>
              </>
            )}
          </button>
        </div>

        {/* Code Content */}
        <pre className="flex-1 p-5 overflow-auto custom-scrollbar bg-slate-50 text-xs font-mono-tabular text-slate-700 leading-relaxed">
          <code>{activeCode}</code>
        </pre>
      </div>
    </div>
  );
};
