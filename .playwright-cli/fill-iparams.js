async (page) => {
  const frame = page.frame({ url: /custom_configs\/form/ });
  await frame.fill('input[name="kwtsms_username"]', 'instabox');
  await frame.fill('input[name="kwtsms_password"]', 'LhVmTF3D^S4xpd');
  await frame.fill('input[name="kwtsms_senderid"]', 'KWT-SMS');
  await frame.fill('input[name="kwtsms_company_name"]', 'kwtSMS');
  console.log('All fields filled');
}
