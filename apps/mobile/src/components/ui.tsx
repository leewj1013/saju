import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

export const C = {
  ground: '#FEFEFE', // 로고 JPEG 바탕색과 같게. 흰 카드는 테두리로 구분
  surface: '#FFFFFF',
  ink: '#1B1F24',
  ink2: '#4E5752',
  ink3: '#626A64', // 가장 어두운 바탕(tint)에서도 4.5:1 이상
  rule: '#D3D9D3',
  ruleSoft: '#E4E8E3',
  tint: '#E9EDE8',
  danger: '#B3261E',
};

// PRD §7.4 오행 색. 오행 의미에만 쓰고 버튼·링크 강조색으로 쓰지 않는다
export const OH: Record<string, { bg: string; fg: string; border: string }> = {
  WOOD: { bg: '#1E5AA8', fg: '#FFFFFF', border: '#1E5AA8' },
  FIRE: { bg: '#C62828', fg: '#FFFFFF', border: '#C62828' },
  EARTH: { bg: '#E0A800', fg: '#1A1A1A', border: '#E0A800' },
  METAL: { bg: '#FAFAF7', fg: '#1A1A1A', border: '#9E9E9E' },
  WATER: { bg: '#1A1A1A', fg: '#FFFFFF', border: '#1A1A1A' },
};

export function Segmented<T extends string>({ label, options, value, onChange }: {
  label: string;
  options: { value: T; label: string; disabled?: boolean }[];
  value: T | null;
  onChange: (value: T) => void;
}) {
  return (
    <View style={s.segmented} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map(o => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            disabled={o.disabled}
            accessibilityRole="radio"
            accessibilityLabel={o.label}
            accessibilityState={{ checked: on, disabled: o.disabled }}
            style={({ pressed }) => [s.segment, on && s.segmentOn, o.disabled && s.disabled, pressed && !on && s.pressed]}
          >
            <Text style={[s.segmentText, on && s.segmentTextOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Button({ label, onPress, disabled, loading, loadingLabel = '처리 중…', variant = 'primary', size = 'md' }: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  loadingLabel?: string;
  variant?: 'primary' | 'secondary';
  size?: 'md' | 'sm'; // sm: 카드 안 보조 버튼. 보이는 높이는 38이지만 hitSlop으로 터치 영역 44 이상 유지
}) {
  const primary = variant === 'primary';
  const small = size === 'sm';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      hitSlop={small ? 6 : undefined}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      style={({ pressed }) => [s.button, small && s.buttonSm, primary ? s.primary : s.secondary, disabled && s.buttonDisabled, pressed && s.pressed]}
    >
      <Text style={[s.buttonText, small && s.buttonTextSm, { color: primary ? C.surface : C.ink }]}>{loading ? loadingLabel : label}</Text>
    </Pressable>
  );
}

export const Label = ({ children, required }: { children: ReactNode; required?: boolean }) => (
  <Text style={s.label}>
    {children}
    {required ? <Text style={{ color: C.danger }}> *</Text> : null}
  </Text>
);

export const ErrorText = ({ children }: { children?: string }) =>
  children ? <Text style={s.error} accessibilityLiveRegion="polite">{children}</Text> : null;

export const Chip = ({ label }: { label: string }) => (
  <View style={s.chip}>
    <Text style={s.chipText}>{label}</Text>
  </View>
);

export function Sheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: ReactNode }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.sheetWrap}>
        <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel="닫기" />
        <View style={s.sheet}>
          <View style={s.sheetHead}>
            <Text style={s.sheetTitle}>{title}</Text>
            <Pressable onPress={onClose} accessibilityRole="button" hitSlop={12}>
              <Text style={s.sheetClose}>닫기</Text>
            </Pressable>
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  segmented: { flexDirection: 'row', backgroundColor: C.tint, borderRadius: 8, padding: 3, gap: 3 },
  segment: { flex: 1, minHeight: 44, borderRadius: 6, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  segmentOn: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.rule },
  segmentText: { fontSize: 15, color: C.ink2 },
  segmentTextOn: { color: C.ink, fontWeight: '600' },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
  button: { minHeight: 48, borderRadius: 8, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  primary: { backgroundColor: C.ink },
  secondary: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.rule },
  buttonDisabled: { opacity: 0.35 },
  buttonText: { fontSize: 16, fontWeight: '600' },
  buttonSm: { minHeight: 38, paddingHorizontal: 14 },
  buttonTextSm: { fontSize: 14 },
  label: { fontSize: 14, fontWeight: '600', color: C.ink },
  error: { fontSize: 13, color: C.danger, lineHeight: 19 },
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: C.tint },
  chipText: { fontSize: 13, color: C.ink, fontWeight: '500' },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(27,31,36,0.45)' },
  sheet: {
    backgroundColor: C.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, paddingBottom: 32,
    gap: 12, width: '100%', maxWidth: 560, alignSelf: 'center', maxHeight: '85%',
  },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: C.ink },
  sheetClose: { fontSize: 15, color: C.ink2 },
});
