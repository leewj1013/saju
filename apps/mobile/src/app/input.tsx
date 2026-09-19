// SCR-INPUT-01 사주 입력 + SCR-INPUT-02 확인 시트 (PRD §7.1)
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Button, C, ErrorText, Label, Segmented, Sheet } from '../components/ui';
import {
  REGIONS, ReadingError, checkDate, checkTime, correctionMin, errorMessage, formatMin, hasLeapMonth, hourSlots,
  listProfiles, loadMatchDraft, openProfile, regionName, requestReading, saveLast, saveMatchDraft, track,
} from '../lib/saju';
import type { ArchivedProfile, Gender, Options, Profile } from '../lib/saju';

const onlyDigits = (text: string, max: number) => text.replace(/\D/g, '').slice(0, max);
const fmtDate = (d: string) => d.slice(0, 4) + (d.length > 4 ? `.${d.slice(4, 6)}` : '') + (d.length > 6 ? `.${d.slice(6)}` : '');
const fmtTime = (d: string) => d.slice(0, 2) + (d.length > 2 ? `:${d.slice(2)}` : '');

export default function InputScreen() {
  const [name, setName] = useState('');
  const [gender, setGender] = useState<Gender | null>(null);
  const [calendar, setCalendar] = useState<Profile['calendar']>('SOLAR');
  const [isLeapMonth, setLeapMonth] = useState(false);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [timeUnknown, setTimeUnknown] = useState(false);
  const [regionCode, setRegionCode] = useState('11');
  const [jasiMode, setJasiMode] = useState<Options['jasiMode']>('UNIFIED');
  const [longitudeCorrection, setLongitudeCorrection] = useState(true);
  const [showMethod, setShowMethod] = useState(false);
  const [touched, setTouched] = useState({ date: false, time: false });
  const [sheet, setSheet] = useState<'region' | 'hour' | 'confirm' | null>(null);
  const [loading, setLoading] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  // for=a|b: 궁합 고르기에서 사람을 새로 입력하러 온 경우. 결과 화면 대신 궁합 화면으로 돌아간다
  const { login, for: target } = useLocalSearchParams<{ login?: string; for?: string }>();
  const matchSide = target === 'a' || target === 'b' ? target : null;

  // 대표 사주 (PRD §3.3 홈): 로그인했고 대표를 지정했을 때만. 로그인 전이면 조용히 넘어간다
  const [primary, setPrimary] = useState<ArchivedProfile | null>(null);
  const [openingPrimary, setOpeningPrimary] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    listProfiles().then(r => setPrimary(r.profiles.find(p => p.isPrimary) ?? null)).catch(() => {});
  }, []);
  const openPrimary = async () => {
    if (!primary) return;
    setOpeningPrimary(true);
    try {
      const { profile, options, reading } = await openProfile(primary.profileId);
      await saveLast({ profile, options, reading });
      router.push('/result?from=archive');
    } catch (e) {
      setServerErrors({ form: errorMessage(e instanceof ReadingError ? e.errors[0]?.code : 'SERVER_ERROR') });
    } finally {
      setOpeningPrimary(false);
    }
  };

  const started = useRef(false);
  const markStarted = () => {
    if (started.current) return;
    started.current = true;
    track('input_start');
  };

  const clearServerError = (field: string) =>
    setServerErrors(({ [field]: _, form: __, ...rest }) => rest);

  const dateCheck = date.length === 8 ? checkDate(calendar, isLeapMonth, date) : null;
  const dateError = serverErrors.birthDate
    ?? dateCheck?.error
    ?? (touched.date && date.length < 8 ? '생년월일 8자리를 입력해 주세요. 예: 19900101' : undefined);
  const timeFormatError = time.length === 4
    ? checkTime(time)
    : touched.time && time.length < 4 ? '태어난 시간 4자리를 입력해 주세요. 예: 1430' : undefined;
  const timeError = timeUnknown ? undefined : serverErrors.birthTime ?? timeFormatError;

  // 입력 오류 계측: 코드가 바뀔 때 한 번씩
  const dateErrorCode = dateCheck?.code ?? (touched.date && date.length < 8 ? 'DATE_FORMAT' : undefined);
  const timeErrorCode = timeUnknown || !timeFormatError ? undefined : time.length === 4 ? 'TIME_INVALID' : 'TIME_FORMAT';
  useEffect(() => {
    if (dateErrorCode) track('input_error', { field: 'birthDate', code: dateErrorCode });
  }, [dateErrorCode]);
  useEffect(() => {
    if (timeErrorCode) track('input_error', { field: 'birthTime', code: timeErrorCode });
  }, [timeErrorCode]);
  const leapAvailable = date.length >= 6 && hasLeapMonth(+date.slice(0, 4), +date.slice(4, 6));

  const canSubmit = !!gender && !!dateCheck && !dateCheck.error && (timeUnknown || (time.length === 4 && !timeFormatError));
  const correction = correctionMin(regionCode);
  const methodSummary = `${jasiMode === 'UNIFIED' ? '23시에 날짜 변경' : '야자시·조자시 구분'} · 경도 보정 ${longitudeCorrection ? formatMin(correction) : '끔'}`;

  const profile: Profile = {
    name: name.trim(),
    gender: gender ?? 'M',
    calendar,
    isLeapMonth: calendar === 'LUNAR' && isLeapMonth,
    birthDate: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`,
    birthTime: timeUnknown ? null : `${time.slice(0, 2)}:${time.slice(2, 4)}`,
    regionCode,
  };

  async function submit() {
    setLoading(true);
    setServerErrors({});
    track('input_submit', { calendar, hourKnown: !timeUnknown });
    try {
      const options = { jasiMode, longitudeCorrection };
      const reading = await requestReading(profile, options); // 궁합 상대여도 서버 검증을 거친다
      setSheet(null);
      if (matchSide) {
        await saveMatchDraft({ ...(await loadMatchDraft()), [matchSide]: { profile, options } });
        if (router.canGoBack()) router.back();
        else router.replace('/match');
        return;
      }
      await saveLast({ profile, options, reading });
      router.push('/result?from=submit');
    } catch (e) {
      const errors = e instanceof ReadingError ? e.errors : [{ field: null, code: 'SERVER_ERROR' }];
      for (const err of errors) track('input_error', { field: err.field ?? 'form', code: err.code });
      setServerErrors(Object.fromEntries(errors.map(err => [err.field ?? 'form', errorMessage(err.code)])));
      setSheet(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={st.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {matchSide && <Stack.Screen options={{ title: matchSide === 'b' ? '궁합 상대 입력' : '궁합 · 내 사주 입력' }} />}
      <ScrollView contentContainerStyle={st.page} keyboardShouldPersistTaps="handled">
        <View style={st.form}>
          {login === 'failed' && <ErrorText>Google 로그인에 실패했습니다. 잠시 뒤 다시 시도해 주세요.</ErrorText>}
          {primary && !matchSide && (
            <View style={st.last}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={st.lastLabel}>대표 사주</Text>
                <Text style={st.lastText}>{primary.name || '이름 없음'} · {primary.dayPillar}일주</Text>
                <Text style={st.helper}>
                  {primary.currentDaewoon ? `지금 ${primary.currentDaewoon} 대운 · ` : ''}올해 {primary.thisYearSeun}년
                </Text>
              </View>
              <Button variant="secondary" label="열기" onPress={openPrimary} loading={openingPrimary} loadingLabel="여는 중…" />
            </View>
          )}

          <View style={st.field}>
            <Label>이름 (선택)</Label>
            <TextInput
              value={name} onChangeText={t => { markStarted(); setName(t); }} maxLength={12} placeholder="홍길동" placeholderTextColor={C.ink3}
              style={st.input} accessibilityLabel="이름" autoComplete="off"
            />
          </View>

          <View style={st.field}>
            <Label required>성별</Label>
            <Segmented label="성별" value={gender} onChange={v => { markStarted(); setGender(v); }} options={[{ value: 'M', label: '남' }, { value: 'F', label: '여' }]} />
          </View>

          <View style={st.field}>
            <View style={st.row}>
              <Label required>생년월일</Label>
              <View style={st.calendarToggle}>
                <Segmented
                  label="양력 음력" value={calendar}
                  onChange={v => { setCalendar(v); clearServerError('birthDate'); }}
                  options={[{ value: 'SOLAR', label: '양력' }, { value: 'LUNAR', label: '음력' }]}
                />
              </View>
            </View>
            <TextInput
              value={fmtDate(date)}
              onChangeText={t => { markStarted(); setDate(onlyDigits(t, 8)); clearServerError('birthDate'); }}
              onBlur={() => setTouched(x => ({ ...x, date: true }))}
              keyboardType="number-pad" inputMode="numeric" maxLength={10}
              placeholder="1990.01.01" placeholderTextColor={C.ink3}
              style={[st.input, !!dateError && st.inputError]} accessibilityLabel="생년월일 8자리"
            />
            {dateCheck?.converted && !dateError ? <Text style={st.helper}>└ {dateCheck.converted}</Text> : null}
            <ErrorText>{dateError}</ErrorText>
            {calendar === 'LUNAR' && (
              <Segmented
                label="평달 윤달" value={isLeapMonth ? 'LEAP' : 'NORMAL'}
                onChange={v => { setLeapMonth(v === 'LEAP'); clearServerError('birthDate'); }}
                options={[
                  { value: 'NORMAL', label: '평달' },
                  { value: 'LEAP', label: '윤달', disabled: !leapAvailable && !isLeapMonth },
                ]}
              />
            )}
          </View>

          <View style={st.field}>
            <View style={st.row}>
              <Label required>태어난 시간</Label>
              <Pressable
                onPress={() => { markStarted(); setTimeUnknown(u => !u); clearServerError('birthTime'); }}
                accessibilityRole="checkbox" accessibilityLabel="태어난 시간 모름" aria-checked={timeUnknown} hitSlop={8} style={st.check}
              >
                <View style={[st.box, timeUnknown && st.boxOn]}>{timeUnknown ? <Text style={st.boxMark}>✓</Text> : null}</View>
                <Text style={st.checkText}>모름</Text>
              </Pressable>
            </View>
            <View style={st.row}>
              <TextInput
                editable={!timeUnknown}
                value={timeUnknown ? '' : fmtTime(time)}
                onChangeText={t => { markStarted(); setTime(onlyDigits(t, 4)); clearServerError('birthTime'); }}
                onBlur={() => setTouched(x => ({ ...x, time: true }))}
                keyboardType="number-pad" inputMode="numeric" maxLength={5}
                placeholder={timeUnknown ? '시간 모름' : '14:30'} placeholderTextColor={C.ink3}
                style={[st.input, st.grow, timeUnknown && st.inputDisabled, !!timeError && st.inputError]}
                accessibilityLabel="태어난 시간 4자리"
              />
              <Button variant="secondary" label="12지시" onPress={() => setSheet('hour')} disabled={timeUnknown} />
            </View>
            {timeUnknown ? <Text style={st.helper}>시주를 제외한 6글자로 풀이합니다.</Text> : <ErrorText>{timeError}</ErrorText>}
          </View>

          <View style={st.field}>
            <Label>태어난 지역</Label>
            <Pressable
              style={[st.input, st.select]} onPress={() => setSheet('region')}
              accessibilityRole="button" accessibilityLabel={`태어난 지역, ${regionName(regionCode)}`}
            >
              <Text style={st.selectText}>{regionName(regionCode)}</Text>
              <Text style={st.caret}>▾</Text>
            </Pressable>
          </View>

          <View style={st.field}>
            <Pressable onPress={() => setShowMethod(v => !v)} accessibilityRole="button" accessibilityLabel={`계산 방식, ${methodSummary}`} accessibilityState={{ expanded: showMethod }} style={st.methodToggle}>
              <Text style={st.methodTitle}>{showMethod ? '▾' : '▸'} 계산 방식</Text>
              {!showMethod && <Text style={st.helper}>{methodSummary}</Text>}
            </Pressable>
            {showMethod && (
              <View style={st.method}>
                <Label>자시</Label>
                <Segmented
                  label="자시 방식" value={jasiMode} onChange={setJasiMode}
                  options={[{ value: 'UNIFIED', label: '23시에 날짜 변경' }, { value: 'SPLIT', label: '야자시·조자시' }]}
                />
                <Text style={st.helper}>
                  {jasiMode === 'UNIFIED'
                    ? '23:00 이후에 태어나면 다음 날로 봅니다.'
                    : '23:00–24:00은 당일(야자시), 00:00–01:00은 다음 날(조자시)로 봅니다.'}
                </Text>
                <View style={[st.row, st.divider]}>
                  <View style={st.grow}>
                    <Label>지역 경도 보정</Label>
                    <Text style={st.helper}>{regionName(regionCode)} 기준 {formatMin(correction)}</Text>
                  </View>
                  <Switch
                    value={longitudeCorrection} onValueChange={setLongitudeCorrection} accessibilityLabel="지역 경도 보정"
                    trackColor={{ true: C.ink, false: C.rule }} thumbColor={C.surface}
                  />
                </View>
              </View>
            )}
          </View>

          <View style={st.field}>
            <ErrorText>{serverErrors.form}</ErrorText>
            <Button label={matchSide ? '궁합에 넣기' : '사주 결과 보기'} onPress={() => setSheet('confirm')} disabled={!canSubmit} />
            {!canSubmit && (
              <Text style={[st.helper, st.center]}>
                성별, 생년월일, 태어난 시간을 입력하면 {matchSide ? '궁합에 넣을' : '결과를 볼'} 수 있어요.
              </Text>
            )}
          </View>
        </View>
      </ScrollView>

      <Sheet visible={sheet === 'region'} title="태어난 지역" onClose={() => setSheet(null)}>
        <ScrollView>
          {REGIONS.map(r => (
            <Pressable
              key={r.code} style={st.listItem} accessibilityRole="button" accessibilityState={{ selected: r.code === regionCode }}
              onPress={() => { setRegionCode(r.code); setSheet(null); }}
            >
              <Text style={[st.listText, r.code === regionCode && st.bold]}>{r.name}</Text>
              <Text style={st.helper}>{r.code === regionCode ? '선택됨 · ' : ''}{formatMin(correctionMin(r.code))}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </Sheet>

      <Sheet visible={sheet === 'hour'} title="12지시로 고르기" onClose={() => setSheet(null)}>
        <Text style={st.helper}>
          {longitudeCorrection ? `${regionName(regionCode)} 경도 보정 ${formatMin(correction)}을 반영한 시각입니다. ` : ''}
          고르면 구간의 가운데 시각으로 채웁니다.
        </Text>
        <ScrollView>
          {hourSlots(longitudeCorrection ? correction : 0).map(slot => (
            <Pressable
              key={slot.label} style={st.listItem} accessibilityRole="button"
              onPress={() => { setTime(slot.center.replace(':', '')); setTouched(x => ({ ...x, time: true })); clearServerError('birthTime'); setSheet(null); }}
            >
              <Text style={st.listText}>{slot.label} <Text style={st.hanja}>{slot.hanja}</Text></Text>
              <Text style={[st.helper, st.tabular]}>{slot.range}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </Sheet>

      <Sheet visible={sheet === 'confirm'} title="입력한 정보를 확인해 주세요" onClose={() => setSheet(null)}>
        <View style={st.confirm}>
          <Text style={st.confirmMain}>
            {calendar === 'SOLAR' ? '양력' : `음력${isLeapMonth ? ' 윤달' : ''}`} {fmtDate(date)} {timeUnknown ? '· 시간 모름' : fmtTime(time)}
          </Text>
          {dateCheck?.converted ? <Text style={st.helper}>{dateCheck.converted}</Text> : null}
          <Text style={st.confirmLine}>{gender === 'F' ? '여' : '남'} · {regionName(regionCode)}{name.trim() ? ` · ${name.trim()}` : ''}</Text>
          <Text style={st.helper}>계산 방식: {methodSummary}</Text>
        </View>
        <View style={st.row}>
          <View style={st.grow}><Button variant="secondary" label="수정" onPress={() => setSheet(null)} /></View>
          <View style={st.grow}>
            <Button label={matchSide ? '이 사람으로 고르기' : '운세 보기'} onPress={submit} loading={loading} loadingLabel={matchSide ? '확인하는 중…' : '결과를 만드는 중…'} />
          </View>
        </View>
      </Sheet>
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.ground },
  page: { padding: 20, paddingBottom: 48, alignItems: 'center' },
  form: { width: '100%', maxWidth: 560, gap: 24 },
  field: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  grow: { flex: 1 },
  center: { textAlign: 'center' },
  bold: { fontWeight: '600' },
  tabular: { fontVariant: ['tabular-nums'] },
  calendarToggle: { width: 150 },
  input: {
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.rule, borderRadius: 8, paddingHorizontal: 14,
    minHeight: 48, fontSize: 16, color: C.ink, fontVariant: ['tabular-nums'],
  },
  inputError: { borderColor: C.danger },
  inputDisabled: { backgroundColor: C.tint },
  select: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  selectText: { fontSize: 16, color: C.ink },
  caret: { fontSize: 14, color: C.ink2 },
  helper: { fontSize: 13, color: C.ink2, lineHeight: 19 },
  check: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  box: { width: 20, height: 20, borderRadius: 4, borderWidth: 1.5, borderColor: C.ink2, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface },
  boxOn: { backgroundColor: C.ink, borderColor: C.ink },
  boxMark: { color: C.surface, fontSize: 13, fontWeight: '700', lineHeight: 16 },
  checkText: { fontSize: 15, color: C.ink },
  last: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.surface, borderRadius: 10, borderWidth: 1, borderColor: C.rule, padding: 14 },
  lastLabel: { fontSize: 12, color: C.ink2, letterSpacing: 0.4 },
  lastText: { fontSize: 15, color: C.ink, fontWeight: '600' },
  methodToggle: { gap: 4, paddingVertical: 2 },
  methodTitle: { fontSize: 15, fontWeight: '600', color: C.ink },
  method: { gap: 10, backgroundColor: C.surface, borderRadius: 10, borderWidth: 1, borderColor: C.ruleSoft, padding: 14 },
  divider: { borderTopWidth: 1, borderTopColor: C.ruleSoft, paddingTop: 12, marginTop: 4 },
  listItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 50, borderBottomWidth: 1, borderBottomColor: C.ruleSoft },
  listText: { fontSize: 16, color: C.ink },
  hanja: { color: C.ink2 },
  confirm: { gap: 6, backgroundColor: C.tint, borderRadius: 10, padding: 14 },
  confirmMain: { fontSize: 18, fontWeight: '700', color: C.ink, fontVariant: ['tabular-nums'] },
  confirmLine: { fontSize: 15, color: C.ink },
});
