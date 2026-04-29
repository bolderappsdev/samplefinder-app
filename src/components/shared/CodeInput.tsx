import React, { useRef, useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import {
  View,
  TextInput,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';

interface CodeInputProps {
  length?: number;
  onCodeComplete?: (code: string) => void;
  value?: string;
  onChangeText?: (code: string) => void;
  editable?: boolean;
  /** When false, allows alphanumeric input (letters + numbers). Default true = numeric only. */
  numericOnly?: boolean;
}

export interface CodeInputRef {
  focus: () => void;
}

const CodeInput = forwardRef<CodeInputRef, CodeInputProps>(({
  length = 6,
  onCodeComplete,
  value: controlledValue,
  onChangeText,
  editable = true,
  numericOnly = true,
}, ref) => {
  const [code, setCode] = useState<string[]>(Array(length).fill(''));
  const inputRefs = useRef<(TextInput | null)[]>([]);
  const isControlled = controlledValue !== undefined;

  useEffect(() => {
    if (isControlled && controlledValue !== undefined) {
      const codeArray = controlledValue.split('').slice(0, length);
      const newCode = [...codeArray, ...Array(length - codeArray.length).fill('')];
      setCode(newCode);
    }
  }, [controlledValue, length, isControlled]);

  const handleChange = (text: string, index: number) => {
    const allowedPattern = numericOnly ? /[^0-9]/g : /[^a-zA-Z0-9]/g;
    const filteredText = text.replace(allowedPattern, '');

    if (filteredText.length > 1) {
      // Handle paste or auto-fill
      const pastedCode = filteredText.slice(0, length);
      const newCode = Array(length).fill('');
      
      // Fill from the beginning regardless of which input triggered the auto-fill
      pastedCode.split('').forEach((char, i) => {
        if (i < length) {
          newCode[i] = char;
        }
      });
      setCode(newCode);

      const codeString = newCode.join('');
      onChangeText?.(codeString);

      // Focus the last filled input or the last one if all are filled
      const lastFilledIndex = Math.min(pastedCode.length - 1, length - 1);
      inputRefs.current[lastFilledIndex]?.focus();

      if (codeString.length === length && codeString.split('').every(digit => digit !== '')) {
        onCodeComplete?.(codeString);
      }
      return;
    }

    const newCode = [...code];
    newCode[index] = filteredText;
    setCode(newCode);

    const codeString = newCode.join('');
    onChangeText?.(codeString);

    // Move to next input if there's a value
    if (filteredText && index < length - 1) {
      inputRefs.current[index + 1]?.focus();
    }

    // Check if code is complete
    if (codeString.length === length && codeString.split('').every(digit => digit !== '')) {
      onCodeComplete?.(codeString);
    }
  };

  const handleKeyPress = (e: any, index: number) => {
    if (e.nativeEvent.key === 'Backspace' && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleFocus = (index: number) => {
    inputRefs.current[index]?.focus();
  };

  useImperativeHandle(ref, () => ({
    focus: () => {
      inputRefs.current[0]?.focus();
    },
  }));

  return (
    <View style={styles.container}>
      {Array.from({ length }).map((_, index) => (
        <TouchableOpacity
          key={index}
          activeOpacity={1}
          onPress={() => handleFocus(index)}
          style={styles.inputWrapper}
        >
          <View style={[styles.circle, code[index] && styles.circleFilled]}>
            <TextInput
              ref={(ref) => {
                inputRefs.current[index] = ref;
              }}
              style={styles.input}
              value={code[index] || ''}
              onChangeText={(text) => handleChange(text, index)}
              onKeyPress={(e) => handleKeyPress(e, index)}
              keyboardType={numericOnly ? 'number-pad' : 'default'}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={length}
              selectTextOnFocus
              editable={editable}
              autoComplete={index === 0 ? 'one-time-code' : 'off'}
              textContentType={index === 0 ? 'oneTimeCode' : 'none'}
            />
          </View>
        </TouchableOpacity>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    marginVertical: 16,
  },
  inputWrapper: {
    alignItems: 'center',
  },
  circle: {
    width: 42,
    height: 42,
    borderRadius: 30,
    backgroundColor: '#D9D9D9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleFilled: {
    backgroundColor: '#B8B8B8',
  },
  input: {
    fontSize: 16,
    fontFamily: 'Quicksand_600SemiBold',
    color: '#2D1B69',
    textAlign: 'center',
    width: '100%',
    height: '100%',
  },
});

export default CodeInput;

