// The owner's settings for this site. Neither value is a secret.
// googleClientId: the OAuth client ID (type Web) made in the owner's Google Cloud project, with
//   authorised JavaScript origin https://aws.platform.sovereignweb.site. Empty: the page says so.
// templateUrl: an https S3 address of cloudformation/bootstrap.yaml. AWS's quick-create link
//   reads templates from S3 only; with it set, "Set up this account" is a single button.
//   Empty: the page offers the template as a download for the CloudFormation console instead.
window.SITE_CONFIG = {
  googleClientId: "",
  templateUrl: ""
};
