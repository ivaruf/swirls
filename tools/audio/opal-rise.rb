# Opal Rise — a cluster of soap bubbles, iridescent rims that ride the throw,
# then let buoyancy take over: rising, swaying, wobbling, until each pops into
# a soft ring or slips off the top.
#
# TIMBRE: glass again, and deliberately the same bell as petal-fall — these
# two are meant to be a pair (see petal-fall.rb). What separates them apart
# from direction is the iridescence: every bell here is doubled ten cents
# sharp, so each note shimmers against itself the way an oil film does.
# MOTION: a rise, C5 -> Eb5, and then Ab5 on a plain sine, softer than
# anything under it — the pop, which in this effect is not a burst but a rim
# letting go.
with_fx :reverb, room: 0.7, mix: 0.38 do
  with_fx :lpf, cutoff: 100 do
    use_synth :pretty_bell
    [[:c5, 0.28], [:ds5, 0.33]].each do |n, a|
      play n, attack: 0.1, release: 0.5, amp: a
      play note(n) + 0.1, attack: 0.1, release: 0.5, amp: a * 0.6
      sleep 0.2
    end
    use_synth :sine
    play :gs5, attack: 0.12, release: 0.45, amp: 0.19
  end
end
