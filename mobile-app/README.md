# FarmtoClick Mobile App

A React Native mobile application for FarmtoClick built with Expo.

## Features

- 🔐 User Authentication (Login/Register)
- 🏠 Home screen with featured products
- 🛒 Product browsing and search
- 👥 Farmer discovery
- 🛍️ Shopping cart
- 👤 User profile management
- 📱 Mobile-optimized UI

## Prerequisites

- Node.js (v14 or later)
- npm or yarn
- Expo CLI (`npm install -g @expo/cli`)
- Expo Go app on your mobile device

## Setup Instructions

### 1. Install Dependencies
```bash
cd FarmtoClick-Mobile
npm install
```

### 2. Configure API Endpoint
Update the API base URL in `src/services/api.ts`:
```typescript
const API_BASE_URL = 'http://YOUR_COMPUTER_IP:5001'; // Replace with your Flask server IP
```

### 3. Start the Flask Backend
Make sure your Flask server is running on the configured IP and port.

### 4. Start the Expo Development Server
```bash
npm start
```

### 5. Run on Device
- Install Expo Go on your mobile device
- Scan the QR code displayed in the terminal
- The app will load on your device

## Project Structure

```
src/
├── components/          # Reusable UI components
├── context/            # React Context for state management
│   └── AuthContext.tsx # Authentication state
├── screens/            # Screen components
│   ├── LoginScreen.tsx
│   ├── RegisterScreen.tsx
│   ├── HomeScreen.tsx
│   ├── ProductsScreen.tsx
│   ├── ProductDetailScreen.tsx
│   ├── FarmersScreen.tsx
│   ├── ProfileScreen.tsx
│   └── CartScreen.tsx
├── services/           # API services
│   └── api.ts
├── types/              # TypeScript type definitions
│   └── index.ts
└── utils/              # Utility functions
```

## API Integration

The app communicates with the Flask backend through REST API endpoints:

- `POST /api/auth/login` - User login
- `POST /api/auth/register` - User registration
- `GET /api/products` - Get all products
- `GET /api/products/:id` - Get product details
- `GET /api/farmers` - Get all farmers
- `GET /api/user/profile` - Get user profile
- `PUT /api/user/profile` - Update user profile

## Key Technologies

- **React Native**: Mobile app framework
- **Expo**: Development platform
- **TypeScript**: Type safety
- **React Navigation**: Navigation between screens
- **Axios**: HTTP client for API calls
- **AsyncStorage**: Local data storage

## Development Notes

- The app uses JWT tokens for authentication
- API calls automatically include auth headers
- Error handling is implemented for network requests
- The UI is optimized for mobile devices

## Troubleshooting

### Network Issues
- Ensure your Flask server is running and accessible
- Update the API_BASE_URL with your computer's IP address
- Check that both devices are on the same network

### Build Issues
- Clear Expo cache: `expo r -c`
- Reinstall dependencies: `rm -rf node_modules && npm install`

### Authentication Issues
- Check that JWT tokens are properly stored
- Verify API endpoints are correct
- Ensure Flask server has CORS enabled

## Next Steps

- [ ] Complete ProductDetailScreen implementation
- [ ] Add Cart functionality
- [ ] Implement Orders management
- [ ] Add Farmer profile screens
- [ ] Integrate payment processing
- [ ] Add push notifications
- [ ] Implement offline mode

## Contributing

1. Follow the existing code structure
2. Use TypeScript for type safety
3. Test on both iOS and Android
4. Follow React Native best practices

## License

This project is part of the FarmtoClick ecosystem.