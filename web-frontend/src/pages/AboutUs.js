import React from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

const AboutUs = () => {

  const teamMembers = [
    {
      name: 'Member 1',
      role: 'Full-Stack Developer',
      icon: 'fa-user-graduate',
      campus: 'TUP - Taguig Campus',
      year: '3rd Year BSIT',
      socials: {
        linkedin: 'https://linkedin.com',
        github: 'https://github.com',
        facebook: 'https://facebook.com',
      },
    },
    {
      name: 'Member 2',
      role: 'Frontend Developer',
      icon: 'fa-user-graduate',
      campus: 'TUP - Taguig Campus',
      year: '3rd Year BSIT',
      socials: {
        linkedin: 'https://linkedin.com',
        github: 'https://github.com',
        facebook: 'https://facebook.com',
      },
    },
    {
      name: 'Member 3',
      role: 'Backend Developer',
      icon: 'fa-user-graduate',
      campus: 'TUP - Taguig Campus',
      year: '3rd Year BSIT',
      socials: {
        linkedin: 'https://linkedin.com',
        github: 'https://github.com',
        facebook: 'https://facebook.com',
      },
    },
    {
      name: 'Member 4',
      role: 'UI/UX & QA',
      icon: 'fa-user-graduate',
      campus: 'TUP - Taguig Campus',
      year: '3rd Year BSIT',
      socials: {
        linkedin: 'https://linkedin.com',
        github: 'https://github.com',
        facebook: 'https://facebook.com',
      },
    },
  ];

  return (
    <div className="about-us-page">
      <Navbar activePage="about" />

      <div className="container" style={{ marginTop: '100px', marginBottom: '60px' }}>
        <div className="section-header">
          <span className="section-badge">Team</span>
          <h2>The Development Team</h2>
          <p>The people behind FarmtoClick</p>
        </div>
        <div className="team-grid">
          {teamMembers.map((member, index) => (
            <div key={index} className="team-card" style={{ padding: '30px 20px' }}>
              <div className="team-avatar" style={{ marginBottom: '15px' }}>
                <i className={`fas ${member.icon}`}></i>
              </div>
              <h3 style={{ marginBottom: '5px' }}>{member.name}</h3>
              <p className="team-role" style={{ color: '#4CAF50', fontWeight: 'bold', marginBottom: '10px' }}>
                {member.role}
              </p>
              <div style={{ fontSize: '0.9rem', color: '#666', marginBottom: '15px' }}>
                <p style={{ margin: '0' }}>{member.campus}</p>
                <p style={{ margin: '0' }}>{member.year}</p>
              </div>

              <div className="team-socials" style={{ display: 'flex', justifyContent: 'center', gap: '15px' }}>
                {member.socials.linkedin && (
                  <a
                    href={member.socials.linkedin}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: '#0077b5', fontSize: '1.2rem' }}
                  >
                    <i className="fab fa-linkedin"></i>
                  </a>
                )}
                {member.socials.github && (
                  <a
                    href={member.socials.github}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: '#333', fontSize: '1.2rem' }}
                  >
                    <i className="fab fa-github"></i>
                  </a>
                )}
                {member.socials.facebook && (
                  <a
                    href={member.socials.facebook}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: '#1877f2', fontSize: '1.2rem' }}
                  >
                    <i className="fab fa-facebook"></i>
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <Footer />
    </div>
  );
};
export default AboutUs;
