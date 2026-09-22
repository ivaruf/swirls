# Drift Tide — a shoal of teal streaks that swims where it was sent, then
# slows and wanders as one body, under shafts of sunlit water.
#
# TIMBRE: water. FAMILY: the broad one — filtered noise with no grain to it,
# the sound of a body moving through water rather than of water breaking.
# MOTION: a lateral glide that eases off. The tone slides Eb4 -> C4 as the
# shoal loses its throw, which is literally what the effect draws.
#
# Ab major pentatonic, like all twelve (see mode.rb for why that key).
with_fx :reverb, room: 0.6, mix: 0.3 do
  with_fx :lpf, cutoff: 86 do
    use_synth :cnoise
    play 60, attack: 0.22, sustain: 0.06, release: 0.5, amp: 0.28, cutoff: 78
    use_synth :sine
    n = play :ds4, attack: 0.18, sustain: 0.1, release: 0.7, amp: 0.20, note_slide: 0.7
    control n, note: :c4
    play :as4, attack: 0.25, release: 0.6, amp: 0.09, pan: 0.2
  end
end
