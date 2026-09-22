# Verdant Surge — a green will that surges where thrown, dragging a dense
# swarm of tiny particles around and behind it like iron filings in a field.
#
# TIMBRE: dry and granular, and the driest thing in the set — the reverb mix
# is 0.24 where most of the others sit near 0.35. Pink noise under a cutoff of
# 70 has a grain to it that the smooth :cnoise water cues deliberately do not,
# and that grain is the swarm.
# MOTION: a gathering surge. Everything builds rather than decays, and the
# tone climbs Bb3 -> C4 as the field pulls itself together.
with_fx :reverb, room: 0.5, mix: 0.24 do
  with_fx :lpf, cutoff: 88 do
    use_synth :pnoise
    play 60, attack: 0.3, sustain: 0.06, release: 0.3, amp: 0.17, cutoff: 70
    use_synth :tri
    n = play :as3, attack: 0.25, sustain: 0.08, release: 0.45, amp: 0.20, note_slide: 0.4
    control n, note: :c4
  end
end
