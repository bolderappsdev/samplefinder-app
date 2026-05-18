import { StyleSheet } from 'react-native';
import { AUTH_WHITE_CONTENT_TOP_PADDING } from '@/constants/authLayout';

const styles = StyleSheet.create({
  headerBackButton: {
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  wrapperContent: {
    paddingVertical: 0,
    paddingHorizontal: 30,
    paddingTop: AUTH_WHITE_CONTENT_TOP_PADDING,
    paddingBottom: 30,
  },
  contentContainer: {
    flex: 1,
    width: '100%',
  },
  title: {
    fontSize: 28,
    fontFamily: 'Quicksand_700Bold',
    color: '#2D1B69',
    textAlign: 'center',
    marginBottom: 24,
    textTransform: 'uppercase',
  },
  instruction: {
    fontSize: 16,
    fontFamily: 'Quicksand_400Regular',
    color: '#666',
    textAlign: 'center',
    marginBottom: 8,
    lineHeight: 24,
  },
  emailText: {
    fontSize: 16,
    fontFamily: 'Quicksand_600SemiBold',
    color: '#2D1B69',
    textAlign: 'center',
    marginBottom: 16,
    marginTop: 4,
  },
  errorContainer: {
    marginTop: 12,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  errorText: {
    fontSize: 14,
    fontFamily: 'Quicksand_500Medium',
    color: '#FF6B6B',
    textAlign: 'center',
  },
  buttonContainer: {
    width: '100%',
    marginTop: 20,
    marginBottom: 16,
  },
  resendContainer: {
    marginTop: 8,
  },
  resendText: {
    fontSize: 16,
    fontFamily: 'Quicksand_500Medium',
    color: '#999',
    textAlign: 'center',
  },
  resendTextDisabled: {
    color: '#CCC',
  },
  resendLoadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  resendLoadingText: {
    marginLeft: 8,
  },
});

export default styles;

