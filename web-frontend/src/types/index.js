export interface User {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  phone?: string;
  is_farmer: boolean;
  profile_picture?: string;
  farm_name?: string;
  farm_location?: string;
  overall_location?: string;
  shipping_address?: string;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  image: string;
  farmer_name: string;
  category: string;
  quantity: number;
  unit: string;
  location: string;
  farmer_id: string;
}

export interface Farmer {
  id: string;
  first_name: string;
  last_name: string;
  farm_name: string;
  farm_location: string;
  profile_picture?: string;
  phone?: string;
}

export interface CartItem {
  product: Product;
  quantity: number;
}

export interface Order {
  id: string;
  items: CartItem[];
  total: number;
  status: string;
  created_at: string;
  shipping_address: string;
}