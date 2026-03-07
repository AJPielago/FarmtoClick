export interface User {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  phone?: string;
  role?: string;
  is_farmer: boolean;
  is_admin?: boolean;
  is_active?: boolean;
  is_verified?: boolean;
  deactivation_reason?: string | null;
  deactivated_at?: string | null;
  profile_picture?: string;
  farm_name?: string;
  farm_location?: string;
  farm_phone?: string;
  farm_description?: string;
  exact_address?: string;
  overall_location?: string;
  shipping_address?: string;
  overall_location_2?: string;
  shipping_address_2?: string;
  permit_business_name?: string;
  permit_owner_name?: string;
  verification_status?: 'pending' | 'verified' | 'rejected' | 'none';
}

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  image: string;
  image_url?: string;
  image_urls?: string[];
  farmer_name: string;
  category: string;
  quantity: number;
  unit: string;
  location: string;
  farmer_id: string;
  available?: boolean;
  created_at?: string;
  average_rating?: number;
  review_count?: number;
}

export interface Farmer {
  id: string;
  first_name: string;
  last_name: string;
  email?: string;
  farm_name: string;
  farm_location: string;
  farm_description?: string;
  farm_phone?: string;
  profile_picture?: string;
  phone?: string;
  is_verified?: boolean;
  overall_location?: string;
  exact_address?: string;
}

export interface CartItem {
  product: Product;
  quantity: number;
}

export interface Order {
  id: string;
  _id?: string;
  order_number?: string;
  items: OrderItem[];
  total: number;
  total_amount?: number;
  status: OrderStatus;
  created_at: string;
  updated_at?: string;
  shipping_address?: string;
  shipping_name?: string;
  shipping_phone?: string;
  payment_method?: string;
  delivery_status?: string;
  delivery_tracking_id?: string;
  delivery_proof_url?: string;
  delivery_notes?: string;
  logistics_provider?: string;
  tracking_number?: string;
  delivery_updates?: DeliveryUpdate[];
  delivery_status_updated_at?: string;
}

export interface OrderItem {
  product_id: string;
  product_name: string;
  quantity: number;
  price: number;
  unit?: string;
  image?: string;
}

export interface DeliveryUpdate {
  status: string;
  timestamp?: string;
  updated_at?: string;
  time?: string;
  description?: string;
}

export type OrderStatus = 
  | 'pending'
  | 'confirmed'
  | 'approved'
  | 'preparing'
  | 'ready'
  | 'ready_for_ship'
  | 'picked_up'
  | 'on_the_way'
  | 'completed'
  | 'delivered'
  | 'cancelled'
  | 'rejected';

export interface SellerOrder extends Order {
  buyer_name?: string;
  buyer_phone?: string;
  buyer_email?: string;
  rejection_reason?: string;
}

export interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
}

export interface PriceSuggestion {
  found: boolean;
  message?: string;
  auto_price?: number;
  srp_price?: number;
  name?: string;
  unit?: string;
}

export interface ProductSuggestion {
  name: string;
  category?: string;
}

// Navigation types
export type RootStackParamList = {
  Login: undefined;
  Register: undefined;
  MainTabs: undefined;
  ProductDetail: { product: Product };
  FarmerProfile: { farmerId: string };
  EditProfile: undefined;
  Orders: undefined;
  RiderOrders: undefined;
  FarmerDashboard: undefined;
  ManageProducts: undefined;
  StartSelling: undefined;
  AddProduct: undefined;
  EditProduct: { product: Product };
  FarmerVerify: undefined;
  AdminDashboard: undefined;
  VerificationDashboard: undefined;
  PriceTrends: undefined;
  DTIPriceManagement: undefined;
  CoVendorsMarketplace: undefined;
  AdminRiders: undefined;
  Notifications: undefined;
  AboutUs: undefined;
  AdminPrintableReports: undefined;
  AdminReviews: undefined;
  AdminUsers: undefined;
  FarmerOrders: undefined;
  RiderDashboard: undefined;
  RiderRouteMap: undefined;
  FarmerPrintableReports: undefined;
  RiderPrintableReports: undefined;
};