import React, { useRef } from 'react';
import { View, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { Colors } from '@/constants/Colors';

type TouchableRef = React.ComponentRef<typeof TouchableOpacity>;

export type FilterType = 'radius' | 'dates' | 'categories' | 'reset';

export interface FilterButtonLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type MeasureCallback = (callback: (layout: FilterButtonLayout) => void) => void;

interface FilterButtonsProps {
  selectedFilter: FilterType | null;
  onFilterPress: (filter: FilterType, measureFn: MeasureCallback) => void;
  radiusCount?: number;
  datesCount?: number;
  categoriesCount?: number;
  hasAnyFilters?: boolean;
}

const FilterButtons: React.FC<FilterButtonsProps> = ({
  selectedFilter,
  onFilterPress,
  radiusCount = 0,
  datesCount = 0,
  categoriesCount = 0,
  hasAnyFilters = false,
}) => {
  const radiusButtonRef = useRef<TouchableRef>(null);
  const datesButtonRef = useRef<TouchableRef>(null);
  const categoriesButtonRef = useRef<TouchableRef>(null);

  const createMeasureFn = (ref: React.RefObject<TouchableRef | null> | null): MeasureCallback => {
    return (callback) => {
      if (ref?.current) {
        ref.current.measureInWindow((x, y, width, height) => {
          callback({ x, y, width, height });
        });
      }
    };
  };

  const handleFilterPress = (filter: FilterType, ref: React.RefObject<TouchableRef | null> | null) => {
    if (filter === 'reset') {
      onFilterPress(filter, () => {});
    } else {
      onFilterPress(filter, createMeasureFn(ref));
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.buttonsRow}>
        <TouchableOpacity
          ref={radiusButtonRef}
          style={[
            styles.filterButton,
            (selectedFilter === 'radius' || radiusCount > 0) && styles.filterButtonSelected,
          ]}
          onPress={() => handleFilterPress('radius', radiusButtonRef)}
          activeOpacity={0.7}
        >
          <Text
            style={[
              styles.filterButtonText,
              (selectedFilter === 'radius' || radiusCount > 0) && styles.filterButtonTextSelected,
            ]}
          >
            Radius
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          ref={datesButtonRef}
          style={[
            styles.filterButton,
            (selectedFilter === 'dates' || datesCount > 0) && styles.filterButtonSelected,
          ]}
          onPress={() => handleFilterPress('dates', datesButtonRef)}
          activeOpacity={0.7}
        >
          <Text
            style={[
              styles.filterButtonText,
              (selectedFilter === 'dates' || datesCount > 0) && styles.filterButtonTextSelected,
            ]}
          >
            Dates
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          ref={categoriesButtonRef}
          style={[
            styles.filterButton,
            (selectedFilter === 'categories' || categoriesCount > 0) && styles.filterButtonSelected,
          ]}
          onPress={() => handleFilterPress('categories', categoriesButtonRef)}
          activeOpacity={0.7}
        >
          <Text
            style={[
              styles.filterButtonText,
              (selectedFilter === 'categories' || categoriesCount > 0) && styles.filterButtonTextSelected,
            ]}
          >
            Categories
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.filterButton,
            styles.filterButtonReset,
            hasAnyFilters && styles.filterButtonResetEnabled,
          ]}
          onPress={() => handleFilterPress('reset', null)}
          activeOpacity={0.7}
          disabled={!hasAnyFilters}
        >
          <Text
            style={[
              styles.filterButtonTextReset,
              hasAnyFilters && styles.filterButtonTextResetEnabled,
            ]}
          >
            Reset
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: 12,
    backgroundColor: Colors.white,
    width: '100%',
  },
  buttonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: 20,
    columnGap: 6,
  },
  filterButton: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: Colors.blueColorMode,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterButtonSelected: {
    backgroundColor: Colors.blueColorMode,
    borderColor: Colors.blueColorMode,
  },
  filterButtonReset: {
    backgroundColor: '#E0E0E0',
    borderColor: '#9E9E9E',
  },
  filterButtonResetEnabled: {
    backgroundColor: Colors.blueColorMode,
    borderColor: Colors.blueColorMode,
  },
  filterButtonText: {
    fontSize: 16,
    fontFamily: 'Quicksand_700Bold',
    color: Colors.blueColorMode,
    textAlign: 'center',
  },
  filterButtonTextSelected: {
    color: Colors.white,
  },
  filterButtonTextReset: {
    fontSize: 16,
    fontFamily: 'Quicksand_700Bold',
    color: '#9E9E9E',
    textAlign: 'center',
  },
  filterButtonTextResetEnabled: {
    color: Colors.white,
  },
});

export default FilterButtons;

