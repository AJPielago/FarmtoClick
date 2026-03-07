import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';

const AboutUsScreen: React.FC = () => {
  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>About FarmtoClick</Text>
        <Text style={styles.subtitle}>Connecting local farmers directly with consumers</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Our Mission</Text>
        <Text style={styles.paragraph}>
          FarmtoClick aims to empower local farmers by providing them with a direct platform to sell their fresh produce to consumers. We believe in fair prices for farmers and fresh, high-quality food for everyone.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>How It Works</Text>
        <Text style={styles.paragraph}>
          1. Farmers list their fresh produce on our platform.{'\n'}
          2. Consumers browse and purchase directly from local farms.{'\n'}
          3. Our dedicated riders deliver the fresh produce right to your doorstep.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Contact Us</Text>
        <Text style={styles.paragraph}>
          Email: support@farmtoclick.com{'\n'}
          Phone: +63 912 345 6789
        </Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  header: {
    backgroundColor: '#4CAF50',
    padding: 30,
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 16,
    color: 'white',
    textAlign: 'center',
    opacity: 0.9,
  },
  section: {
    padding: 20,
    backgroundColor: 'white',
    margin: 15,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2c7a2c',
    marginBottom: 15,
  },
  paragraph: {
    fontSize: 16,
    color: '#444',
    lineHeight: 24,
  },
});

export default AboutUsScreen;
