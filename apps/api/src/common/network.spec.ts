import { isPrivateOrReservedAddress } from '@resolveai/shared';

describe('network destination validation', () => {
  it.each(['127.0.0.1', '0.0.0.0', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '::1', 'fe80::1', '::ffff:127.0.0.1', '64:ff9b::c000:0201'])('blocks reserved destination %s', (address) => {
    expect(isPrivateOrReservedAddress(address)).toBe(true);
  });

  it('allows a normal public address', () => {
    expect(isPrivateOrReservedAddress('93.184.216.34')).toBe(false);
  });
});
