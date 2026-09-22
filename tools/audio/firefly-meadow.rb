# Firefly Meadow — a swarm of warm gold lights, flung with the throw, that
# scatter and wander, blinking on a shared rhythm in loose half-synchrony.
#
# TIMBRE: warm, and the only pulsed cue in the set. A triangle under a cutoff
# of 84 is gold rather than yellow — the effect's own description says "bright
# quick attack", and that is the one thing NOT translated, because bright and
# quick is what a cue firing every 120 ms must never be. The blink is carried
# by the rhythm instead of by the edge.
# MOTION: three pulses on F4, fading, scattered across the field, and one C5
# still glowing after the last of them has gone dark.
with_fx :reverb, room: 0.62, mix: 0.3 do
  with_fx :lpf, cutoff: 84 do
    use_synth :tri
    3.times do |i|
      play :f4, attack: 0.07, sustain: 0.02, release: 0.34, amp: 0.18 - i * 0.04, pan: rrand(-0.45, 0.45)
      sleep 0.2
    end
    use_synth :sine
    play :c5, attack: 0.1, release: 0.4, amp: 0.06
  end
end
