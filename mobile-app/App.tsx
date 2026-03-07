import React, { useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from './src/theme';

// Import screens
import LoginScreen from './src/screens/LoginScreen';
import RegisterScreen from './src/screens/RegisterScreen';
import HomeScreen from './src/screens/HomeScreen';
import ProductsScreen from './src/screens/ProductsScreen';
import ProductDetailScreen from './src/screens/ProductDetailScreen';
import FarmersScreen from './src/screens/FarmersScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import CartScreen from './src/screens/CartScreen';
import OrdersScreen from './src/screens/OrdersScreen';
import EditProfileScreen from './src/screens/EditProfileScreen';
import FarmerDashboardScreen from './src/screens/FarmerDashboardScreen';
import ManageProductsScreen from './src/screens/ManageProductsScreen';
import StartSellingScreen from './src/screens/StartSellingScreen';
import FarmerProfileScreen from './src/screens/FarmerProfileScreen';
import FarmerVerifyScreen from './src/screens/FarmerVerifyScreen';
import AdminDashboardScreen from './src/screens/AdminDashboardScreen';
import VerificationDashboardScreen from './src/screens/VerificationDashboardScreen';
import RiderOrdersScreen from './src/screens/RiderOrdersScreen';
import DTIPriceManagementScreen from './src/screens/DTIPriceManagementScreen';
import CoVendorsMarketplaceScreen from './src/screens/CoVendorsMarketplaceScreen';
import AdminRidersScreen from './src/screens/AdminRidersScreen';
import NotificationsScreen from './src/screens/NotificationsScreen';
import PriceTrendsScreen from './src/screens/PriceTrendsScreen';
import AboutUsScreen from './src/screens/AboutUsScreen';
import AdminUsersScreen from './src/screens/AdminUsersScreen';
import AdminReviewsScreen from './src/screens/AdminReviewsScreen';
import AdminPrintableReportsScreen from './src/screens/AdminPrintableReportsScreen';
import FarmerOrdersScreen from './src/screens/FarmerOrdersScreen';
import RiderDashboardScreen from './src/screens/RiderDashboardScreen';
import RiderRouteMapScreen from './src/screens/RiderRouteMapScreen';
import FarmerPrintableReportsScreen from './src/screens/FarmerPrintableReportsScreen';
import RiderPrintableReportsScreen from './src/screens/RiderPrintableReportsScreen';

// Context
import { AuthProvider } from './src/context/AuthContext';
import { CartProvider, useCart } from './src/context/CartContext';

// Components
import ErrorBoundary from './src/components/ErrorBoundary';
import OfflineBanner from './src/components/OfflineBanner';

// Types
import { RootStackParamList } from './src/types';

const Stack = createStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator();

function TabNavigator() {
  // Safe check if CartProvider is available, though it should be
  const cart = useCart();
  const count = cart ? cart.cartCount : 0;

  return (
    <Tab.Navigator
      initialRouteName="Products"
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName: any;

          if (route.name === 'Home') {
            iconName = focused ? 'home' : 'home-outline';
          } else if (route.name === 'Products') {
            iconName = focused ? 'storefront' : 'storefront-outline';
          } else if (route.name === 'Farmers') {
            iconName = focused ? 'people' : 'people-outline';
          } else if (route.name === 'Profile') {
            iconName = focused ? 'person' : 'person-outline';
          } else if (route.name === 'Cart') {
            iconName = focused ? 'basket' : 'basket-outline';
          }

          return <Ionicons name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: COLORS.textSecondary,
        headerStyle: {
          backgroundColor: COLORS.primary,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.1,
          shadowRadius: 4,
          elevation: 4,
        },
        headerTintColor: COLORS.surface,
        headerTitleStyle: {
          fontWeight: 'bold',
          fontSize: 18,
        },
        tabBarStyle: {
          backgroundColor: COLORS.surface,
          borderTopWidth: 0,
          elevation: 8,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.05,
          shadowRadius: 4,
          paddingBottom: 5,
          height: 60,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '500',
          marginBottom: 5,
        }
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Products" component={ProductsScreen} />
      <Tab.Screen name="Farmers" component={FarmersScreen} />
      <Tab.Screen 
        name="Cart" 
        component={CartScreen} 
        options={{ tabBarBadge: count > 0 ? count : undefined }}
      />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
    <AuthProvider>
      <CartProvider>
        <NavigationContainer>
          <Stack.Navigator
            initialRouteName="Login"
            screenOptions={{
              headerStyle: {
                backgroundColor: COLORS.primary,
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.1,
                shadowRadius: 4,
                elevation: 4,
              },
              headerTintColor: COLORS.surface,
              headerTitleStyle: {
                fontWeight: 'bold',
              },
              contentStyle: {
                backgroundColor: COLORS.background,
              }
            }}
          >
            <Stack.Screen
              name="Login"
              component={LoginScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="Register"
            component={RegisterScreen}
            options={{ title: 'Create Account', headerShown: false }}
          />
          <Stack.Screen
            name="MainTabs"
            component={TabNavigator}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="ProductDetail"
            component={ProductDetailScreen}
            options={{ title: 'Product Details' }}
          />
          <Stack.Screen
            name="Orders"
            component={OrdersScreen}
            options={{ title: 'My Orders' }}
          />
          <Stack.Screen
            name="EditProfile"
            component={EditProfileScreen}
            options={{ title: 'Edit Profile' }}
          />
          <Stack.Screen
            name="FarmerDashboard"
            component={FarmerDashboardScreen}
            options={{ title: 'My Shop Dashboard' }}
          />
          <Stack.Screen
            name="ManageProducts"
            component={ManageProductsScreen}
            options={{ title: 'Manage Products' }}
          />
          <Stack.Screen
            name="StartSelling"
            component={StartSellingScreen}
            options={{ title: 'Start Selling' }}
          />
          <Stack.Screen
            name="FarmerProfile"
            component={FarmerProfileScreen}
            options={{ title: 'Farmer Profile' }}
          />
          <Stack.Screen
            name="FarmerVerify"
            component={FarmerVerifyScreen}
            options={{ title: 'Verify Your Farm' }}
          />
          <Stack.Screen
            name="AdminDashboard"
            component={AdminDashboardScreen}
            options={{ title: 'Admin Dashboard' }}
          />
          <Stack.Screen
            name="DTIPriceManagement"
            component={DTIPriceManagementScreen}
            options={{ title: 'DTI Price Management' }}
          />
          <Stack.Screen
            name="CoVendorsMarketplace"
            component={CoVendorsMarketplaceScreen}
            options={{ title: 'Vendors Marketplace' }}
          />
          <Stack.Screen
            name="AdminRiders"
            component={AdminRidersScreen}
            options={{ title: 'Manage Riders' }}
          />
          <Stack.Screen
            name="Notifications"
            component={NotificationsScreen}
            options={{ title: 'Notifications' }}
          />
          <Stack.Screen
            name="PriceTrends"
            component={PriceTrendsScreen}
            options={{ title: 'Price Trends' }}
          />
          <Stack.Screen
            name="VerificationDashboard"
            component={VerificationDashboardScreen}
            options={{ title: 'Farmer Verifications' }}
          />
          <Stack.Screen
            name="RiderOrders"
            component={RiderOrdersScreen}
            options={{ title: 'Assigned Orders' }}
          />
          <Stack.Screen
            name="AboutUs"
            component={AboutUsScreen}
            options={{ title: 'About Us' }}
          />
          <Stack.Screen
            name="AdminUsers"
            component={AdminUsersScreen}
            options={{ title: 'Manage Users' }}
          />
          <Stack.Screen
            name="AdminReviews"
            component={AdminReviewsScreen}
            options={{ title: 'Manage Reviews' }}
          />
          <Stack.Screen
            name="AdminPrintableReports"
            component={AdminPrintableReportsScreen}
            options={{ title: 'System Reports' }}
          />
          <Stack.Screen
            name="FarmerOrders"
            component={FarmerOrdersScreen}
            options={{ title: 'Manage Orders' }}
          />
          <Stack.Screen
            name="RiderDashboard"
            component={RiderDashboardScreen}
            options={{ title: 'Rider Dashboard' }}
          />
          <Stack.Screen
            name="RiderRouteMap"
            component={RiderRouteMapScreen}
            options={{ title: 'Delivery Route Map' }}
          />
          <Stack.Screen
            name="FarmerPrintableReports"
            component={FarmerPrintableReportsScreen}
            options={{ title: 'Farmer Reports' }}
          />
          <Stack.Screen
            name="RiderPrintableReports"
            component={RiderPrintableReportsScreen}
            options={{ title: 'Rider Reports' }}
          />
        </Stack.Navigator>
        <StatusBar style="auto" />
      </NavigationContainer>
      <OfflineBanner />
      </CartProvider>
    </AuthProvider>
    </ErrorBoundary>
  );
}
