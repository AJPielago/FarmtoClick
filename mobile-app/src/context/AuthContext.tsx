import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { api, userAPI, API_BASE_URL, setLogoutCallback } from '../services/api';
import { User } from '../types';

// Helper to store/retrieve token securely
// SecureStore is encrypted; fall back to AsyncStorage for non-sensitive data
const TOKEN_KEY = 'userToken';
const USER_DATA_KEY = 'userData';

const secureSetToken = async (token: string) => {
  try {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  } catch {
    // Fallback for environments where SecureStore isn't available
    await AsyncStorage.setItem(TOKEN_KEY, token);
  }
};

const secureGetToken = async (): Promise<string | null> => {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return await AsyncStorage.getItem(TOKEN_KEY);
  }
};

const secureRemoveToken = async () => {
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    await AsyncStorage.removeItem(TOKEN_KEY);
  }
};

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<boolean | string>;
  register: (userData: RegisterData) => Promise<boolean | string>;
  logout: () => Promise<void>;
  updateProfile: (userData: Partial<User>) => Promise<boolean>;
  refreshUser: () => Promise<void>;
}

interface RegisterData {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  phone?: string;
  is_farmer?: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    checkAuthState();
    setLogoutCallback(async () => {
      if (__DEV__) console.log('[Auth] Global logout triggered');
      await logout();
    });
  }, []);

  const checkAuthState = async () => {
    try {
      const storedToken = await secureGetToken();
      const storedUser = await AsyncStorage.getItem(USER_DATA_KEY);

      if (storedToken && storedUser) {
        setToken(storedToken);
        setUser(JSON.parse(storedUser));
        // Set the token in API headers
        api.defaults.headers.common['Authorization'] = `Bearer ${storedToken}`;
      }
    } catch (error) {
      if (__DEV__) console.error('Error checking auth state:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const login = async (email: string, password: string): Promise<boolean | string> => {
    try {
      setIsLoading(true);
      const response = await api.post('/api/auth/login', { email, password });

      const { token: newToken, user: userData } = response.data;

      if (!newToken || !userData) {
        return 'Server returned an unexpected response. Please try again.';
      }

      setToken(newToken);
      setUser(userData);

      // Store in secure storage
      await secureSetToken(newToken);
      await AsyncStorage.setItem(USER_DATA_KEY, JSON.stringify(userData));

      // Set token in API headers
      api.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;

      return true;
    } catch (error: any) {
      if (__DEV__) console.error('Login error:', error);
      const msg = error?.response?.data?.error || error?.message || 'Login failed';
      return msg;
    } finally {
      setIsLoading(false);
    }
  };

  const register = async (userData: RegisterData): Promise<boolean | string> => {
    try {
      setIsLoading(true);
      const response = await api.post('/api/auth/register', userData);

      const { token: newToken, user: newUser } = response.data;

      if (!newToken || !newUser) {
        return 'Server returned an unexpected response. Please try again.';
      }

      setToken(newToken);
      setUser(newUser);

      // Store in secure storage
      await secureSetToken(newToken);
      await AsyncStorage.setItem(USER_DATA_KEY, JSON.stringify(newUser));

      // Set token in API headers
      api.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;

      return true;
    } catch (error: any) {
      if (__DEV__) console.error('Registration error:', error);
      const msg = error?.response?.data?.error || error?.message || 'Registration failed';
      return msg;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      setUser(null);
      setToken(null);

      // Clear secure storage
      await secureRemoveToken();
      await AsyncStorage.removeItem(USER_DATA_KEY);

      // Remove token from API headers
      delete api.defaults.headers.common['Authorization'];
    } catch (error) {
      if (__DEV__) console.error('Logout error:', error);
    }
  };

  const updateProfile = async (userData: Partial<User>): Promise<boolean> => {
    try {
      setIsLoading(true);
      // If userData is FormData (contains image), use fetch directly to avoid axios multipart issues on RN
      const isFormData = (d: any) => !!d && typeof d.append === 'function';

      if (isFormData(userData)) {
        const tokenToUse = token || (await AsyncStorage.getItem('userToken'));
        const url = `${API_BASE_URL}/api/user/profile`;
        const res = await fetch(url, {
          method: 'PUT',
          headers: {
            Authorization: tokenToUse ? `Bearer ${tokenToUse}` : '',
          },
          body: userData as any,
        });

        const data = await res.json().catch(() => null);
        if (!res.ok) {
          if (__DEV__) console.error('[Auth] updateProfile (FormData) failed:', res.status, data);
          return false;
        }
        const updatedUser = (data && (data.user || data)) || null;
        if (updatedUser && user) {
          const mergedUser = { ...user, ...updatedUser };
          setUser(mergedUser);
          await AsyncStorage.setItem('userData', JSON.stringify(mergedUser));
        }
        return true;
      }

      const response = await userAPI.updateProfile(userData);

      if (response.data) {
        // Use the user data from the server response
        const updatedUser = response.data.user || response.data;
        if (user) {
          const mergedUser = { ...user, ...updatedUser };
          setUser(mergedUser);
          await AsyncStorage.setItem('userData', JSON.stringify(mergedUser));
        }
      }

      return true;
    } catch (error) {
      if (__DEV__) console.error('Profile update error:', error);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const refreshUser = async (): Promise<void> => {
    try {
      const response = await userAPI.getProfile();
      if (response.data) {
        setUser(response.data);
        await AsyncStorage.setItem('userData', JSON.stringify(response.data));
      }
    } catch (error) {
      if (__DEV__) console.error('Failed to refresh user:', error);
    }
  };

  const value: AuthContextType = {
    user,
    token,
    isLoading,
    login,
    register,
    logout,
    updateProfile,
    refreshUser,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};