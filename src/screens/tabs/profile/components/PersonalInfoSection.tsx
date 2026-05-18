import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/Colors';

export interface PersonalInfoData {
  tierStatus?: string;
  dateOfBirth?: string;
  phoneNumber?: string;
  email?: string;
}

interface PersonalInfoSectionProps {
  data?: PersonalInfoData;
}

const PersonalInfoSection: React.FC<PersonalInfoSectionProps> = ({
  data = {
    tierStatus: 'NewbieSampler',
    dateOfBirth: 'April 3, 1979',
    phoneNumber: '(215) 555-1212',
    email: 'thesamplefinder@gmail.com',
  },
}) => {
  return (
    <View style={styles.container}>
      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>TIER STATUS:</Text>
        <Text style={styles.infoValue}>{data.tierStatus}</Text>
      </View>
      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>DATE OF BIRTH:</Text>
        <Text style={styles.infoValue}>{data.dateOfBirth}</Text>
      </View>
      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>PHONE NUMBER:</Text>
        <Text style={styles.infoValue}>{data.phoneNumber}</Text>
      </View>
      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>EMAIL:</Text>
        <Text style={styles.infoValue}>{data.email}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'column',
    paddingHorizontal: 20,
    marginBottom: 24,
    gap: 12,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  infoLabel: {
    fontSize: 17,
    fontFamily: 'Quicksand_700Bold',
    color: Colors.blueColorMode,
    marginRight: 8,
    width: '40%',
  },
  infoValue: {
    fontSize: 17,
    fontFamily: 'Quicksand_500Medium',
    color: Colors.pinBlueBlack,
    flex: 1,
    flexShrink: 1,
  },
});

export default PersonalInfoSection;

