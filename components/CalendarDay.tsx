import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { DateData } from 'react-native-calendars';
import { colors } from '../utils/theme';

export type DayMarking = {
  selected?: boolean;
  selectedColor?: string;
  hasEvent?: boolean;
  hasRangeEvent?: boolean;
  isHoliday?: boolean;
  holidayName?: string;
};

type CalendarDayProps = {
  date?: DateData;
  state?: string;
  marking?: DayMarking;
  onPress?: (date?: DateData) => void;
};

export function CalendarDay({ date, state, marking = {}, onPress }: CalendarDayProps) {
  if (!date) return null;

  const isSelected = !!marking.selected;
  const isDisabled = state === 'disabled';
  const isToday = state === 'today';
  const isHoliday = !!marking.isHoliday;

  return (
    <Pressable style={styles.cell} onPress={() => onPress?.(date)}>
      <View
        style={[
          styles.numberCircle,
          isSelected && { backgroundColor: marking.selectedColor ?? colors.accent },
        ]}
      >
        <Text
          style={[
            styles.numberText,
            isDisabled && styles.numberTextDisabled,
            isToday && !isSelected && styles.numberTextToday,
            isHoliday && !isSelected && !isDisabled && styles.numberTextHoliday,
            isSelected && styles.numberTextSelected,
          ]}
        >
          {date.day}
        </Text>
      </View>
      <Text
        numberOfLines={1}
        style={[styles.holidayLabel, { opacity: isHoliday && !isDisabled ? 1 : 0 }]}
      >
        {marking.holidayName ?? ' '}
      </Text>
      <View style={styles.dotSlot}>
        {marking.hasEvent ? <View style={styles.eventDot} /> : null}
        {marking.hasRangeEvent ? <View style={styles.rangeDot} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cell: {
    width: '100%',
    minHeight: 46,
    alignItems: 'center',
    paddingTop: 2,
  },
  numberCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numberText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  numberTextDisabled: {
    color: colors.textTertiary,
  },
  numberTextToday: {
    color: colors.accent,
    fontWeight: '800',
  },
  numberTextHoliday: {
    color: colors.up,
    fontWeight: '700',
  },
  numberTextSelected: {
    color: '#ffffff',
    fontWeight: '800',
  },
  holidayLabel: {
    marginTop: 1,
    fontSize: 7.5,
    lineHeight: 9,
    color: colors.up,
  },
  dotSlot: {
    height: 4,
    marginTop: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  eventDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.accent,
  },
  rangeDot: {
    width: 5,
    height: 5,
    borderRadius: 1,
    backgroundColor: '#f59e0b',
  },
});
