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
  const rows: { label: string; value?: string }[] = [
    { label: 'TIER STATUS:', value: data.tierStatus },
    { label: 'DATE OF BIRTH:', value: data.dateOfBirth },
    { label: 'PHONE NUMBER:', value: data.phoneNumber },
    { label: 'EMAIL:', value: data.email },
  ];

  return (
    <View style={styles.container}>
      {rows.map(({ label, value }) =>
        value ? (
          <View key={label} style={styles.infoRow}>
            <Text style={styles.infoLabel}>{label}</Text>
            <Text style={styles.infoValue}>{value}</Text>
          </View>
        ) : null,
      )}
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
    lineHeight: 22,
    fontFamily: 'Quicksand_700Bold',
    color: Colors.blueColorMode,
    marginRight: 8,
    width: '40%',
    includeFontPadding: false,
  },
  infoValue: {
    fontSize: 17,
    lineHeight: 22,
    fontFamily: 'Quicksand_500Medium',
    color: Colors.pinBlueBlack,
    flex: 1,
    flexShrink: 1,
    includeFontPadding: false,
  },
});

export default PersonalInfoSection;

