import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { Calendar, DateData, LocaleConfig } from 'react-native-calendars';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CalendarDay, DayMarking } from '../../components/CalendarDay';
import { buildHolidayMap } from '../../utils/holidays';
import { parseScheduleText, toDateString } from '../../utils/scheduleParser';
import { fetchCurrentWeather, WeatherInfo } from '../../utils/weather';

LocaleConfig.locales.ko = {
  monthNames: [
    '1월', '2월', '3월', '4월', '5월', '6월',
    '7월', '8월', '9월', '10월', '11월', '12월',
  ],
  monthNamesShort: [
    '1월', '2월', '3월', '4월', '5월', '6월',
    '7월', '8월', '9월', '10월', '11월', '12월',
  ],
  dayNames: ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'],
  dayNamesShort: ['일', '월', '화', '수', '목', '금', '토'],
  today: '오늘',
};
LocaleConfig.defaultLocale = 'ko';

type ScheduleEvent = {
  id: string;
  groupId: string;
  date: string;
  time: string | null;
  title: string;
  isRange: boolean;
  rangeIndex: number;
  rangeLength: number;
  completed: boolean;
};

const DOUBLE_TAP_THRESHOLD_MS = 300;

const EVENTS_STORAGE_KEY = 'calendar-app/events';
const SHOW_US_HOLIDAYS_KEY = 'calendar-app/showUsHolidays';

function parseDateParts(dateString: string) {
  const [year, month, day] = dateString.split('-').map((part) => parseInt(part, 10));
  return { year, month, day };
}

function formatDisplayDate(dateString: string) {
  const { year, month, day } = parseDateParts(dateString);
  return new Date(year, month - 1, day).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });
}

function getToday() {
  return toDateString(new Date());
}

function createEventId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildLocationLabel(address: Location.LocationGeocodedAddress): string | null {
  // 시/도 -> 시/구 -> 동 순으로 조합해서 "~동" 단위까지 보이도록 한다.
  const parts = [address.region, address.city, address.subregion, address.district].filter(
    (part): part is string => !!part && part.trim().length > 0
  );
  const deduped = parts.filter((part, index) => index === 0 || part !== parts[index - 1]);
  return deduped.length > 0 ? deduped.join(' ') : null;
}

function formatDateForEdit(dateString: string) {
  // 연도까지 명시해서, 수정 시 "오늘" 기준 재해석으로 연도가 밀리는 걸 방지한다.
  const { year, month, day } = parseDateParts(dateString);
  return `${year}년 ${month}월 ${day}일`;
}

function formatTimeForEdit(time: string | null) {
  if (!time) return '';
  const [hourText, minuteText] = time.split(':');
  const hour = parseInt(hourText, 10);
  const minute = parseInt(minuteText, 10);
  const period = hour < 12 ? '오전' : '오후';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return minute === 0 ? `${period} ${hour12}시` : `${period} ${hour12}시 ${minute}분`;
}

function buildEditText(groupEvents: ScheduleEvent[]) {
  const sorted = [...groupEvents].sort((a, b) => a.date.localeCompare(b.date));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const timePhrase = formatTimeForEdit(first.time);
  const datePhrase =
    first.isRange && sorted.length > 1
      ? `${formatDateForEdit(first.date)}부터 ${formatDateForEdit(last.date)}까지`
      : formatDateForEdit(first.date);

  return [datePhrase, timePhrase, first.title].filter(Boolean).join(' ');
}

export default function CalendarScreen() {
  const today = useMemo(getToday, []);
  const [selectedDate, setSelectedDate] = useState(today);
  const [visibleYear, setVisibleYear] = useState(() => new Date(today).getFullYear());
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [showUsHolidays, setShowUsHolidays] = useState(false);
  const [inputText, setInputText] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [weather, setWeather] = useState<WeatherInfo | null>(null);
  const [locationLabel, setLocationLabel] = useState<string | null>(null);
  const [isLocationModalVisible, setIsLocationModalVisible] = useState(false);
  const [manualLocationInput, setManualLocationInput] = useState('');
  const [manualLocationError, setManualLocationError] = useState<string | null>(null);
  const [isGeocodingLocation, setIsGeocodingLocation] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const lastTapRef = useRef<{ id: string; time: number } | null>(null);

  const applyCoordinates = useCallback(async (latitude: number, longitude: number) => {
    const [weatherResult, addresses] = await Promise.all([
      fetchCurrentWeather(latitude, longitude),
      Location.reverseGeocodeAsync({ latitude, longitude }),
    ]);
    setWeather(weatherResult);
    const address = addresses[0];
    setLocationLabel(address ? buildLocationLabel(address) : null);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const position = await Location.getCurrentPositionAsync({});
        await applyCoordinates(position.coords.latitude, position.coords.longitude);
      } catch {
        // 위치/날씨 조회가 실패해도 캘린더 기능에는 영향이 없어야 하므로 조용히 무시한다.
      }
    })();
  }, []);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, (e) => {
      setKeyboardHeight(e.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(EVENTS_STORAGE_KEY),
      AsyncStorage.getItem(SHOW_US_HOLIDAYS_KEY),
    ])
      .then(([rawEvents, rawShowUs]) => {
        if (rawEvents) {
          const parsedEvents: ScheduleEvent[] = JSON.parse(rawEvents);
          setEvents(
            parsedEvents.map((event) => ({
              ...event,
              groupId: event.groupId ?? event.id,
              isRange: event.isRange ?? false,
              rangeIndex: event.rangeIndex ?? 0,
              rangeLength: event.rangeLength ?? 1,
              completed: event.completed ?? false,
            }))
          );
        }
        if (rawShowUs) setShowUsHolidays(JSON.parse(rawShowUs));
      })
      .finally(() => setIsLoaded(true));
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    AsyncStorage.setItem(EVENTS_STORAGE_KEY, JSON.stringify(events)).catch(() => {});
  }, [events, isLoaded]);

  useEffect(() => {
    if (!isLoaded) return;
    AsyncStorage.setItem(SHOW_US_HOLIDAYS_KEY, JSON.stringify(showUsHolidays)).catch(() => {});
  }, [showUsHolidays, isLoaded]);

  const holidayMap = useMemo(
    () => buildHolidayMap([visibleYear - 1, visibleYear, visibleYear + 1], showUsHolidays),
    [visibleYear, showUsHolidays]
  );

  const baseMarkedDates = useMemo(() => {
    const marks: Record<string, DayMarking> = {};

    for (const event of events) {
      const prevMark = marks[event.date];
      marks[event.date] = {
        ...prevMark,
        hasEvent: !!prevMark?.hasEvent || !event.isRange,
        hasRangeEvent: !!prevMark?.hasRangeEvent || event.isRange,
      };
    }

    for (const [date, holidays] of Object.entries(holidayMap)) {
      marks[date] = {
        ...marks[date],
        isHoliday: true,
        holidayName: holidays.map((h) => h.name).join(' · '),
      };
    }

    return marks;
  }, [events, holidayMap]);

  // 날짜 선택만으로는 events/holidayMap 전체를 다시 훑지 않도록 별도 memo로 분리한다.
  const markedDates = useMemo(
    () => ({
      ...baseMarkedDates,
      [selectedDate]: {
        ...baseMarkedDates[selectedDate],
        selected: true,
        selectedColor: '#2563eb',
      },
    }),
    [baseMarkedDates, selectedDate]
  );

  const eventsForSelectedDate = useMemo(
    () =>
      events
        .filter((event) => event.date === selectedDate)
        .sort((a, b) => (a.time ?? '99:99').localeCompare(b.time ?? '99:99')),
    [events, selectedDate]
  );

  const holidaysForSelectedDate = holidayMap[selectedDate] ?? [];

  const cancelInputIfActive = () => {
    if (!editingGroupId && !inputText && keyboardHeight === 0) return;
    setEditingGroupId(null);
    setInputText('');
    setErrorMessage(null);
    Keyboard.dismiss();
  };

  const onDayPress = (day: DateData) => {
    setSelectedDate(day.dateString);
    cancelInputIfActive();
  };

  const onMonthChange = (month: DateData) => {
    setVisibleYear(month.year);
    cancelInputIfActive();
  };

  const onToggleUsHolidays = (value: boolean) => {
    setShowUsHolidays(value);
    cancelInputIfActive();
  };

  const onSubmit = () => {
    const parsed = parseScheduleText(inputText);
    if (!parsed) {
      setErrorMessage('날짜를 인식하지 못했어요. 예: "다음주 금요일 오후 3시에 치과 예약"');
      return;
    }
    const isRange = parsed.dates.length > 1;
    const groupId = editingGroupId ?? createEventId();
    const newEvents: ScheduleEvent[] = parsed.dates.map((date, index) => ({
      id: createEventId(),
      groupId,
      date,
      time: parsed.time,
      title: parsed.title,
      isRange,
      rangeIndex: index,
      rangeLength: parsed.dates.length,
      completed: false,
    }));
    setEvents((prev) => {
      const withoutEdited = editingGroupId
        ? prev.filter((event) => event.groupId !== editingGroupId)
        : prev;
      return [...withoutEdited, ...newEvents];
    });
    setSelectedDate(parsed.dates[0]);
    setInputText('');
    setErrorMessage(null);
    setEditingGroupId(null);
  };

  const deleteGroup = (groupId: string) => {
    setEvents((prev) => prev.filter((event) => event.groupId !== groupId));
    if (editingGroupId === groupId) {
      setEditingGroupId(null);
      setInputText('');
    }
  };

  const onDeleteEvent = (event: ScheduleEvent) => {
    cancelInputIfActive();
    if (!event.isRange) {
      deleteGroup(event.groupId);
      return;
    }
    Alert.alert(
      '기간 일정 삭제',
      `"${event.title}"은(는) ${event.rangeLength}일간 이어지는 일정입니다. 전체 기간을 삭제할까요?`,
      [
        { text: '취소', style: 'cancel' },
        { text: '전체 삭제', style: 'destructive', onPress: () => deleteGroup(event.groupId) },
      ]
    );
  };

  const onToggleCompleted = (id: string) => {
    setEvents((prev) =>
      prev.map((event) => (event.id === id ? { ...event, completed: !event.completed } : event))
    );
  };

  const onEventPress = (id: string) => {
    const now = Date.now();
    const last = lastTapRef.current;
    if (last && last.id === id && now - last.time < DOUBLE_TAP_THRESHOLD_MS) {
      lastTapRef.current = null;
      onToggleCompleted(id);
    } else {
      lastTapRef.current = { id, time: now };
    }
  };

  const onEditEvent = (event: ScheduleEvent) => {
    const groupEvents = events.filter((e) => e.groupId === event.groupId);
    setInputText(buildEditText(groupEvents));
    setEditingGroupId(event.groupId);
    setErrorMessage(null);
    inputRef.current?.focus();
  };

  const onOpenLocationModal = () => {
    setManualLocationInput('');
    setManualLocationError(null);
    setIsLocationModalVisible(true);
  };

  const onCloseLocationModal = () => {
    setIsLocationModalVisible(false);
  };

  const onSubmitManualLocation = async () => {
    const query = manualLocationInput.trim();
    if (!query) {
      setManualLocationError('위치를 입력해 주세요.');
      return;
    }
    setIsGeocodingLocation(true);
    setManualLocationError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setManualLocationError('위치 권한이 필요해요. 설정에서 위치 권한을 허용해 주세요.');
        return;
      }
      const results = await Location.geocodeAsync(query);
      const result = results[0];
      if (!result) {
        setManualLocationError('입력한 위치를 찾지 못했어요. 다르게 입력해 보세요.');
        return;
      }
      await applyCoordinates(result.latitude, result.longitude);
      setIsLocationModalVisible(false);
    } catch {
      setManualLocationError('위치를 가져오지 못했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setIsGeocodingLocation(false);
    }
  };


  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={[styles.container, { paddingBottom: keyboardHeight }]}>
        <TouchableWithoutFeedback onPress={cancelInputIfActive}>
        <ScrollView
          style={styles.container}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator
          persistentScrollbar
        >
        <View style={styles.headerRow}>
          <Text style={styles.header}>캘린더</Text>
          <View style={styles.weatherBadge}>
            {locationLabel ? (
              <Text style={styles.locationText} numberOfLines={1}>
                {locationLabel}
              </Text>
            ) : null}
            {weather ? (
              <>
                <Ionicons name={weather.icon} size={18} color="#374151" />
                <Text style={styles.weatherText}>{weather.temperature}°</Text>
              </>
            ) : null}
            <Pressable onPress={onOpenLocationModal} hitSlop={8}>
              <Ionicons name="location-outline" size={18} color="#6b7280" />
            </Pressable>
          </View>
        </View>

        <View style={styles.optionRow}>
          <Text style={styles.optionLabel}>미국 공휴일 함께 보기</Text>
          <Switch value={showUsHolidays} onValueChange={onToggleUsHolidays} />
        </View>

        <Calendar
          current={selectedDate}
          onDayPress={onDayPress}
          onMonthChange={onMonthChange}
          markedDates={markedDates}
          dayComponent={CalendarDay}
          enableSwipeMonths
          monthFormat="yyyy년 MMMM"
          theme={{
            todayTextColor: '#2563eb',
            arrowColor: '#2563eb',
            selectedDayBackgroundColor: '#2563eb',
            textMonthFontSize: 15,
            textDayHeaderFontSize: 11,
            weekVerticalMargin: 4,
          }}
          style={styles.calendar}
        />

        <View style={styles.detail}>
          <Text style={styles.detailDate}>{formatDisplayDate(selectedDate)}</Text>

          {holidaysForSelectedDate.length > 0 && (
            <View style={styles.holidayBanner}>
              {holidaysForSelectedDate.map((holiday, index) => (
                <Text key={index} style={styles.holidayBannerText}>
                  {holiday.country === 'US' ? '🇺🇸' : '🇰🇷'} {holiday.name}
                </Text>
              ))}
            </View>
          )}

          {eventsForSelectedDate.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>등록된 일정이 없습니다.</Text>
            </View>
          ) : (
            <View>
              {eventsForSelectedDate.map((item) => (
                <Pressable
                  key={item.id}
                  style={styles.eventRow}
                  onPress={() => onEventPress(item.id)}
                >
                  {item.time ? (
                    <Text style={[styles.eventTime, item.completed && styles.eventTextCompleted]}>
                      {item.time}
                    </Text>
                  ) : null}
                  <Text style={[styles.eventTitle, item.completed && styles.eventTextCompleted]}>
                    {item.title}
                  </Text>
                  {item.isRange ? (
                    <View style={styles.rangeBadge}>
                      <Text style={styles.rangeBadgeText}>
                        기간 {item.rangeIndex + 1}/{item.rangeLength}
                      </Text>
                    </View>
                  ) : null}
                  <Pressable
                    style={styles.deleteButton}
                    onPress={() => onEditEvent(item)}
                    disabled={item.completed}
                    hitSlop={8}
                  >
                    <Ionicons
                      name="pencil-outline"
                      size={18}
                      color={item.completed ? '#e5e7eb' : '#9ca3af'}
                    />
                  </Pressable>
                  <Pressable
                    style={styles.deleteButton}
                    onPress={() => onDeleteEvent(item)}
                    disabled={item.completed}
                    hitSlop={8}
                  >
                    <Ionicons
                      name="trash-outline"
                      size={18}
                      color={item.completed ? '#e5e7eb' : '#9ca3af'}
                    />
                  </Pressable>
                </Pressable>
              ))}
            </View>
          )}
        </View>
        </ScrollView>
        </TouchableWithoutFeedback>

        {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
        {editingGroupId ? (
          <View style={styles.editBanner}>
            <Text style={styles.editBannerText}>일정 수정 중</Text>
            <Pressable onPress={cancelInputIfActive} hitSlop={8}>
              <Text style={styles.editBannerCancel}>취소</Text>
            </Pressable>
          </View>
        ) : null}
        <View style={styles.inputRow}>
          <TextInput
            ref={inputRef}
            style={styles.input}
            placeholder="예: 다음주 금요일 오후 3시에 치과 예약"
            placeholderTextColor="#9ca3af"
            value={inputText}
            onChangeText={(text) => {
              setInputText(text);
              if (errorMessage) setErrorMessage(null);
            }}
            onSubmitEditing={onSubmit}
            returnKeyType="done"
          />
          <Pressable style={styles.submitButton} onPress={onSubmit}>
            <Text style={styles.submitButtonText}>{editingGroupId ? '수정' : '등록'}</Text>
          </Pressable>
        </View>
      </View>

      <Modal
        visible={isLocationModalVisible}
        transparent
        animationType="fade"
        onRequestClose={onCloseLocationModal}
      >
        <Pressable style={styles.modalBackdrop} onPress={onCloseLocationModal}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>위치 직접 설정</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="예: 서울 강남구 역삼동"
              placeholderTextColor="#9ca3af"
              value={manualLocationInput}
              onChangeText={(text) => {
                setManualLocationInput(text);
                if (manualLocationError) setManualLocationError(null);
              }}
              onSubmitEditing={onSubmitManualLocation}
              returnKeyType="done"
              autoFocus
            />
            {manualLocationError ? (
              <Text style={styles.modalErrorText}>{manualLocationError}</Text>
            ) : null}
            <View style={styles.modalButtonRow}>
              <Pressable style={styles.modalCancelButton} onPress={onCloseLocationModal}>
                <Text style={styles.modalCancelButtonText}>취소</Text>
              </Pressable>
              <Pressable
                style={styles.modalConfirmButton}
                onPress={onSubmitManualLocation}
                disabled={isGeocodingLocation}
              >
                <Text style={styles.modalConfirmButtonText}>
                  {isGeocodingLocation ? '확인 중...' : '확인'}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  scrollContent: {
    flexGrow: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 2,
  },
  header: {
    fontSize: 19,
    fontWeight: '700',
  },
  weatherBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    maxWidth: '65%',
  },
  locationText: {
    fontSize: 12,
    color: '#6b7280',
    flexShrink: 1,
  },
  weatherText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  optionLabel: {
    fontSize: 13,
    color: '#374151',
  },
  calendar: {
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    backgroundColor: '#ffffff',
    gap: 8,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
  },
  submitButton: {
    backgroundColor: '#2563eb',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  submitButtonText: {
    color: '#ffffff',
    fontWeight: '600',
  },
  errorText: {
    color: '#dc2626',
    fontSize: 12,
    paddingHorizontal: 16,
    paddingTop: 6,
  },
  editBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 6,
  },
  editBannerText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2563eb',
  },
  editBannerCancel: {
    fontSize: 12,
    color: '#6b7280',
  },
  detail: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  detailDate: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  holidayBanner: {
    marginBottom: 12,
  },
  holidayBannerText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#dc2626',
    marginBottom: 2,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 80,
  },
  emptyStateText: {
    color: '#9ca3af',
    fontSize: 14,
  },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
    gap: 12,
  },
  eventTime: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2563eb',
    width: 48,
  },
  eventTitle: {
    fontSize: 14,
    color: '#111827',
    flex: 1,
  },
  eventTextCompleted: {
    textDecorationLine: 'line-through',
    textDecorationColor: '#dc2626',
    color: '#dc2626',
  },
  rangeBadge: {
    backgroundColor: '#fff7ed',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  rangeBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#f59e0b',
  },
  deleteButton: {
    padding: 4,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 20,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  modalErrorText: {
    color: '#dc2626',
    fontSize: 12,
    marginTop: 8,
  },
  modalButtonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 16,
  },
  modalCancelButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
  },
  modalCancelButtonText: {
    color: '#6b7280',
    fontWeight: '600',
  },
  modalConfirmButton: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
  },
  modalConfirmButtonText: {
    color: '#ffffff',
    fontWeight: '600',
  },
});
